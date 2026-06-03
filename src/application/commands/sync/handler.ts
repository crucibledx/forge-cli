import {groupBy} from 'lodash-es'

import type {AssistantDefinition, AssistantId} from '@domain/assistants'
import {getAssistant, resolveAssistantByPath} from '@domain/assistants'
import type {ProjectConfig, Source, SyncConfig} from '@domain/config/types'
import {SYNC_CONFIG_DEFAULTS} from '@domain/config/types'
import type {LocalConflict} from '@domain/sync/conflict'
import {CONFLICT_ACTIONS, detectLocalConflict, LocalConflictError, resolveLocalConflict} from '@domain/sync/conflict'
import {resolveSourceConflicts, SourceConflictError} from '@domain/sync/merge'
import {resolveTargets} from '@domain/sync/resolver'
import type {SyncState} from '@domain/sync/state'
import {buildSyncState} from '@domain/sync/state'
import type {Mutation, ResolvedTarget, SyncFileSummary} from '@domain/sync/types'
import {MUTATION_TYPES, SYNC_FILE_STATUSES} from '@domain/sync/types'
import * as renderer from '@infrastructure/cli/renderer'
import {loadSyncState, writeProjectConfig, writeSyncState} from '@infrastructure/config'
import {applyMutations, collectFiles, readFileContent, rollbackMutations} from '@infrastructure/fs'
import type {IOContext} from '@infrastructure/io'
import io from '@infrastructure/io'
import {getSourceLoader} from '@infrastructure/source'

import {SYNC_MESSAGES as M} from './messages'
import type {SyncCommandAction, SyncOptions} from './types'

export const runSync: SyncCommandAction = async (options) => {
  const originalLog = console.log
  if (options.silent) {
    console.log = () => {}
  }

  try {
    await runSyncInner(options)
  } finally {
    if (options.silent) {
      console.log = originalLog
    }
  }
}

async function runSyncInner(options: SyncOptions): Promise<void> {
  const projectRoot = io.resolveProjectRoot()
  const context = await io.buildContext(projectRoot)

  if (!context.projectConfig) {
    renderer.renderError(M.errors.noConfig, M.errors.noConfigHint)
    process.exit(1)
  }

  const config = context.projectConfig
  validateConfig(config)

  const assistantDefs = config.assistants.map((a) => getAssistant(a.id))
  const allResolved = await fetchAndResolve(config.sources, assistantDefs)

  if (allResolved.length === 0) {
    renderer.renderWarning(M.warnings.noFilesToSync)
    return
  }

  const strategy = config.sync?.source_conflict_strategy ?? SYNC_CONFIG_DEFAULTS.source_conflict_strategy

  let resolved: ResolvedTarget[]
  try {
    resolved = resolveSourceConflicts(allResolved, strategy)
  } catch (err) {
    if (err instanceof SourceConflictError) {
      renderer.renderError(M.errors.sourceConflict(err.conflicts.length), err.message)
      process.exit(1)
    }
    throw err
  }

  const syncState = await loadSyncState(projectRoot)
  const syncConfig: SyncConfig = {...SYNC_CONFIG_DEFAULTS, ...config.sync}

  let planResult: {summaries: SyncFileSummary[]; mutations: Mutation[]}
  try {
    planResult = await buildPlan(projectRoot, resolved, syncState, syncConfig)
  } catch (err) {
    if (err instanceof LocalConflictError) {
      renderer.renderError(M.errors.localConflict(err.conflicts.length), err.message)
      process.exit(1)
    }
    throw err
  }

  const {summaries, mutations} = planResult

  displayPlan(summaries, config.sources, syncConfig, options.dryRun)

  if (options.dryRun) return

  await executePlan(projectRoot, mutations, resolved, context)
}

export function validateConfig(config: ProjectConfig): void {
  if (config.sources.length === 0) {
    renderer.renderError(M.errors.noSource, M.errors.noSourceHint)
    process.exit(1)
  }

  if (config.assistants?.every((a) => !a.enabled)) {
    renderer.renderError(M.errors.noAssistants, M.errors.noAssistantsHint)
    process.exit(1)
  }
}

export async function fetchAndResolve(
  sources: Source[],
  assistantDefs: AssistantDefinition[],
): Promise<ResolvedTarget[]> {
  const fetchResults = await Promise.allSettled(
    sources.map(async (source) => {
      const loader = getSourceLoader(source.type)
      const {localPath} = await loader.load(source)
      const sourceFiles = await collectFiles(localPath)
      return {source, sourceFiles}
    }),
  )

  const allResolved: ResolvedTarget[] = []

  for (let i = 0; i < sources.length; i++) {
    const result = fetchResults[i]
    const source = sources[i]

    renderer.renderNewline()
    renderer.renderInfo(M.progress.syncingSource(source.name))

    if (result.status === 'rejected') {
      const error = result.reason instanceof Error ? result.reason.message : String(result.reason)
      renderer.renderError(M.errors.sourceFetchFailed(source.name, error))
      continue
    }

    const {sourceFiles} = result.value

    if (sourceFiles.length === 0) {
      renderer.renderWarning(M.warnings.noFilesInSource(source.name))
      continue
    }

    const resolved = resolveTargets(sourceFiles, assistantDefs, source.name)

    if (resolved.length === 0) {
      renderer.renderWarning(M.warnings.noTargetsFromSource(source.name))
      continue
    }

    allResolved.push(...resolved)
  }

  return allResolved
}

export async function buildPlan(
  projectRoot: string,
  resolved: ResolvedTarget[],
  syncState: SyncState,
  syncConfig: SyncConfig,
): Promise<{summaries: SyncFileSummary[]; mutations: Mutation[]}> {
  const summaries: SyncFileSummary[] = []
  const mutations: Mutation[] = []
  const conflicts: LocalConflict[] = []

  for (const target of resolved) {
    try {
      await processTarget(target)
    } catch (err) {
      summaries.push({
        targetPath: target.targetPath,
        sourcePath: target.sourcePath,
        assistantId: target.assistantId,
        status: SYNC_FILE_STATUSES.ERROR,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  if (!syncConfig.keep_local) {
    const resolvedPaths = new Set(resolved.map((r) => r.targetPath))
    for (const targetPath of Object.keys(syncState.files)) {
      if (!resolvedPaths.has(targetPath)) {
        const assistantId = resolveAssistantByPath(targetPath)?.id ?? 'unknown'
        mutations.push({type: MUTATION_TYPES.FILE_DELETE, path: targetPath})
        summaries.push({
          targetPath,
          sourcePath: '',
          assistantId,
          status: SYNC_FILE_STATUSES.DELETED,
        })
      }
    }
  }

  if (conflicts.length > 0) {
    throw new LocalConflictError(conflicts)
  }

  return {summaries, mutations}

  function classifyExisting(target: ResolvedTarget, existing: string): SyncFileSummary['status'] | 'conflict' {
    if (existing === target.content) return SYNC_FILE_STATUSES.NO_CHANGE

    const conflict = detectLocalConflict(target.targetPath, existing, target.content, syncState)
    if (!conflict) return SYNC_FILE_STATUSES.UPDATE

    const {action} = resolveLocalConflict(syncConfig.local_conflict_strategy)

    if (action === CONFLICT_ACTIONS.SKIP) return SYNC_FILE_STATUSES.SKIPPED
    if (action === CONFLICT_ACTIONS.ERROR) {
      conflicts.push(conflict)
      return 'conflict'
    }

    if (syncConfig.backup) {
      mutations.push({type: MUTATION_TYPES.FILE_WRITE, path: `${target.targetPath}.bak`, content: existing})
    }
    return SYNC_FILE_STATUSES.UPDATE
  }

  async function processTarget(target: ResolvedTarget) {
    const existing = await readFileContent(projectRoot, target.targetPath)
    let status: SyncFileSummary['status'] = SYNC_FILE_STATUSES.NEW

    if (existing !== null) {
      const result = classifyExisting(target, existing)
      if (result === 'conflict') return
      status = result
    }

    summaries.push({
      targetPath: target.targetPath,
      sourcePath: target.sourcePath,
      assistantId: target.assistantId,
      status,
    })

    if (status !== SYNC_FILE_STATUSES.NO_CHANGE && status !== SYNC_FILE_STATUSES.SKIPPED) {
      mutations.push({type: MUTATION_TYPES.FILE_WRITE, path: target.targetPath, content: target.content})
    }
  }
}

export function displayPlan(
  summaries: SyncFileSummary[],
  sources: Source[],
  syncConfig: SyncConfig,
  dryRun: boolean,
): void {
  const byAssistant = groupBy(summaries, (item) => item.assistantId)
  const sourceNames = sources.map((s) => s.name).join(', ')

  if (dryRun) {
    renderer.renderInfo(M.output.wouldSync(sourceNames))
  }

  renderer.renderDim(M.output.strategyBanner(syncConfig.source_conflict_strategy, syncConfig.local_conflict_strategy))
  renderer.renderNewline()

  for (const [assistantId, files] of Object.entries(byAssistant)) {
    const def = assistantId === 'unknown' ? {name: 'Other'} : getAssistant(assistantId as AssistantId)
    renderer.render(`${def.name}:`)
    for (const file of files) {
      renderer.renderSyncFile(file.targetPath, file.status, dryRun)
    }
    renderer.renderNewline()
  }

  const errorCount = summaries.filter((s) => s.status === SYNC_FILE_STATUSES.ERROR).length
  const deletedCount = summaries.filter((s) => s.status === SYNC_FILE_STATUSES.DELETED).length
  const skippedCount = summaries.filter((s) => s.status === SYNC_FILE_STATUSES.SKIPPED).length

  if (errorCount > 0) renderer.renderWarning(M.summary.errors(errorCount))
  if (deletedCount > 0) renderer.renderWarning(M.summary.deleted(deletedCount))
  if (skippedCount > 0) renderer.renderInfo(M.summary.skipped(skippedCount))

  if (dryRun) {
    renderer.renderDim(M.output.dryRunHint)
  }
}

export async function executePlan(
  projectRoot: string,
  mutations: Mutation[],
  resolved: ResolvedTarget[],
  context: IOContext,
): Promise<void> {
  const applied = await applyMutations(projectRoot, mutations)
  const failed = applied.find((a) => !a.success)

  if (failed) {
    renderer.renderError(M.errors.applyFailed(failed.error ?? 'Unknown error'))
    renderer.renderDim(M.progress.rollingBack)
    await rollbackMutations(projectRoot, applied)
    renderer.renderDim(M.progress.rollbackComplete)
    process.exit(1)
  }

  const syncState = buildSyncState(resolved)
  await writeSyncState(projectRoot, syncState)

  if (context.projectConfig) {
    await writeProjectConfig(projectRoot, {
      ...context.projectConfig,
      lastSync: syncState.lastSync,
    })
  }

  const sourceNames = context.projectConfig?.sources?.map((s) => s.name).join(', ') ?? ''
  const changeCount = mutations.length
  renderer.renderSuccess(M.output.done(changeCount, sourceNames))
  renderer.renderDim(M.output.lastSync(syncState.lastSync))
}
