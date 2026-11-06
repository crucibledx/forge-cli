import type {AssistantDefinition} from '@domain/assistants'
import {getAllAssistants, getAssistant, resolveAssistantByPath} from '@domain/assistants'
import type {ProjectConfig, Source, SyncConfig} from '@domain/config/types'
import {SYNC_CONFIG_DEFAULTS} from '@domain/config/types'
import {redact} from '@domain/redact'
import {detectLocalConflict} from '@domain/sync/conflict'
import {resolveSourceConflicts, SourceConflictError} from '@domain/sync/merge'
import {CONFIG_PATH, STATE_PATH, validatePathGraph} from '@domain/sync/plan'
import {reconcileState} from '@domain/sync/reconcile'
import {resolveTargets} from '@domain/sync/resolver'
import type {SyncState} from '@domain/sync/state'
import {hashContent} from '@domain/sync/state'
import type {Mutation, ResolvedTarget, SyncFileSummary} from '@domain/sync/types'
import {MUTATION_TYPES as MT, SYNC_FILE_STATUSES as S} from '@domain/sync/types'
import * as renderer from '@infrastructure/cli/renderer'
import {loadSyncState} from '@infrastructure/config/state'
import {serializeProjectConfig} from '@infrastructure/config/writer'
import {createConfinement} from '@infrastructure/fs/confinement'
import {createFileReader} from '@infrastructure/fs/reader'
import type {FileOperation, TransactionIO} from '@infrastructure/fs/transaction'
import {prepareTransaction, TransactionError, transactionIO} from '@infrastructure/fs/transaction'
import type {IOContext, IOService} from '@infrastructure/io'
import io from '@infrastructure/io'
import {createFileLogger} from '@infrastructure/logger'
import type {ReportService} from '@infrastructure/report'
import {loadSourceFiles} from '@infrastructure/source'
import {setTelemetryContext} from '@infrastructure/telemetry'

import {CommandError} from '../types'
import {SafetyError} from './errors'
import {SYNC_MESSAGES as M} from './messages'
import {persistOutcome} from './outcome'
import type {SyncCommandAction, SyncOptions} from './types'

interface SyncDependencies {
  io?: IOService
  reports?: ReportService
  loadSource?: typeof loadSourceFiles
  transaction?: TransactionIO
}

export const runSync: SyncCommandAction = (options) => runSyncWithDependencies(options)

export async function runSyncWithDependencies(
  options: SyncOptions,
  dependencies: SyncDependencies = {},
): Promise<void> {
  renderer.setSilent(Boolean(options.silent))
  const started = Date.now()
  const logger = createFileLogger()
  let config: ProjectConfig | undefined
  const persist = (success: boolean, summaries: SyncFileSummary[], error?: unknown) =>
    persistOutcome({
      dryRun: Boolean(options.dryRun),
      started,
      config,
      reports: dependencies.reports,
      success,
      summaries,
      error,
    })
  try {
    const service = dependencies.io ?? io
    const boundary = await createConfinement(service.resolveProjectRoot())
    await boundary.resolve(CONFIG_PATH)
    await boundary.resolve(STATE_PATH)
    const context = await service.buildContext(boundary.root)
    config = context.projectConfig ?? undefined
    if (!config) throw new CommandError(M.errors.noConfig, M.errors.noConfigHint)
    validateConfig(config, true)
    const enabled = new Set(config.assistants.filter((assistant) => assistant.enabled).map((assistant) => assistant.id))
    const definitions = [...enabled].map(getAssistant)
    logger.info('sync acquisition started', {
      sources: config.sources.map((source) => source.name),
      assistants: [...enabled],
    })
    const acquired = await fetchAndResolve(config.sources, definitions, dependencies.loadSource)
    const syncConfig = {...SYNC_CONFIG_DEFAULTS, ...config.sync}
    let resolved: ResolvedTarget[]
    try {
      resolved = resolveSourceConflicts(acquired, syncConfig.source_conflict_strategy)
    } catch (error) {
      if (error instanceof SourceConflictError) throw new SafetyError(error.message, error.conflicts.length)
      throw error
    }
    const state = await loadSyncState(boundary.root)
    const {summaries, mutations, warnings} = await buildPlan(boundary.root, resolved, state, syncConfig, enabled)
    warnings.forEach(renderer.renderWarning)
    displayPlan(summaries, config.sources, syncConfig, options.dryRun)
    const next = reconcileState(state, resolved, summaries, new Date().toISOString())
    // Preparation validates preview write/access feasibility too; never move it below the dry-run return.
    const prepared = await prepareSync(boundary.root, mutations, next, context, dependencies.transaction)
    if (options.dryRun) return
    await commitPrepared(prepared)
    const synced = summaries.filter(
      (summary) => summary.status === S.NEW || summary.status === S.UPDATE || summary.status === S.DELETED,
    ).length
    setTelemetryContext({file_count: synced})
    renderer.renderSuccess(M.output.done(synced, config.sources.map((source) => source.name).join(', ')))
    renderer.renderDim(M.output.lastSync(next.lastSync))
    await persist(true, summaries)
  } catch (error) {
    process.exitCode = 1
    setTelemetryContext({success: false})
    const message = redact(error instanceof Error ? error.message : String(error))
    logger.error('sync failed', {error: message})
    renderer.renderError(
      message,
      error instanceof CommandError
        ? error.suggestion
        : 'Correct the source/path, then retry a dry-run. No partial sync is permitted.',
    )
    await persist(false, [], error)
  } finally {
    try {
      await logger.rotate()
      logger.flush()
    } catch {
      renderer.renderWarning('File logging unavailable; sync outcome is unchanged.')
    }
    renderer.setSilent(false)
  }
}

export function validateConfig(config: ProjectConfig, configExists = false): void {
  if (!config.sources.length)
    throw new CommandError(M.errors.noSource, configExists ? M.errors.noSourceHintExisting : M.errors.noSourceHint)
  if (!config.assistants.some((assistant) => assistant.enabled))
    throw new CommandError(M.errors.noAssistants, M.errors.noAssistantsHint)
}

export async function fetchAndResolve(
  sources: Source[],
  definitions: AssistantDefinition[],
  load = loadSourceFiles,
): Promise<ResolvedTarget[]> {
  const outcomes = await Promise.allSettled(
    sources.map(async (source) => resolveTargets(await load(source), definitions, source.name, source.layout)),
  )
  const resolved: ResolvedTarget[] = []
  const errors: string[] = []
  for (let i = 0; i < sources.length; i++) {
    const outcome = outcomes[i]
    const name = sources[i].name
    renderer.renderInfo(M.progress.syncingSource(name))
    if (outcome.status === 'rejected') {
      const message = M.errors.sourceFetchFailed(
        name,
        redact(outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)),
      )
      renderer.renderError(message)
      errors.push(message)
    } else {
      renderer.renderDim(`Acquired "${name}": ${outcome.value.length} resolved targets (not yet installed).`)
      resolved.push(...outcome.value)
    }
  }
  if (errors.length)
    throw new SafetyError(`Source acquisition failed; no protected data changed:\n${errors.join('\n')}`, errors.length)
  return resolved
}

export async function buildPlan(
  root: string,
  targets: ResolvedTarget[],
  state: SyncState,
  config: SyncConfig,
  enabled = new Set(getAllAssistants().map((assistant) => assistant.id)),
): Promise<{summaries: SyncFileSummary[]; mutations: Mutation[]; warnings: string[]}> {
  const summaries: SyncFileSummary[] = []
  const mutations: Mutation[] = []
  const warnings: string[] = []
  const errors: string[] = []
  const backups: string[] = []
  const read = await createFileReader(root)
  const selected = targets.filter((target) => enabled.has(target.assistantId))
  const paths = selected.map((target) => target.targetPath)
  const desired = new Set(paths)
  const graph = [...paths, ...Object.keys(state.files).filter((path) => !desired.has(path)), STATE_PATH, CONFIG_PATH]
  // Validate desired/state/metadata aliases before planning can read any candidate.
  validatePathGraph(graph)
  const active = selected.filter((target) => {
    const owner = resolveAssistantByPath(target.targetPath)
    if (owner?.id === target.assistantId && enabled.has(owner.id)) return true
    warnings.push(`Retaining target with disabled, unknown, ambiguous or mismatched ownership: ${target.targetPath}`)
    return false
  })
  const backup = async (path: string, content: Buffer) => {
    const backupPath = `${path}.bak`
    backups.push(backupPath)
    const existing = await read(backupPath)
    if (existing !== null && !existing.equals(content))
      throw new Error(`Different backup already exists: ${backupPath}; preserve or move it before retrying`)
    const text = content.toString('utf8')
    if (existing === null)
      mutations.push({
        type: MT.FILE_WRITE,
        path: backupPath,
        content: Buffer.from(text).equals(content) ? text : content,
        backup: true,
      })
  }
  const policy = (path: string) => {
    if (config.local_conflict_strategy === 'error') throw new Error(`Local conflict: ${path}`)
    return config.local_conflict_strategy === 'local-wins' ? S.SKIPPED : S.UPDATE
  }
  for (const target of active) {
    try {
      const existing = await read(target.targetPath)
      const equal = existing !== null && existing.equals(Buffer.from(target.content))
      let status: SyncFileSummary['status'] = existing === null ? S.NEW : equal ? S.NO_CHANGE : S.UPDATE
      if (existing !== null && !equal) {
        if (detectLocalConflict(target.targetPath, existing, target.content, state)) status = policy(target.targetPath)
        if (status === S.UPDATE && config.backup) await backup(target.targetPath, existing)
      }
      summaries.push({
        targetPath: target.targetPath,
        sourcePath: target.sourcePath,
        assistantId: target.assistantId,
        status,
      })
      if (status === S.NEW || status === S.UPDATE)
        mutations.push({type: MT.FILE_WRITE, path: target.targetPath, content: target.content})
    } catch (error) {
      errors.push(`${target.targetPath}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  for (const [path, entry] of Object.entries(state.files)) {
    if (desired.has(path)) continue
    const owner = resolveAssistantByPath(path)
    if (!owner || !enabled.has(owner.id)) {
      warnings.push(`Retaining tracked path with disabled, unknown or ambiguous ownership: ${path}`)
      continue
    }
    if (config.keep_local) continue
    try {
      const existing = await read(path)
      const changed = existing !== null && (entry.baseline !== 'installed' || hashContent(existing) !== entry.hash)
      const skip = changed && policy(path) === S.SKIPPED
      if (!skip) {
        if (changed && config.backup) await backup(path, existing!)
        mutations.push({type: MT.FILE_DELETE, path})
      }
      summaries.push({targetPath: path, sourcePath: '', assistantId: owner.id, status: skip ? S.SKIPPED : S.DELETED})
    } catch (error) {
      errors.push(`${path}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  // Recheck after generated backups exist: the first graph cannot detect .bak collisions.
  validatePathGraph([...graph, ...backups])
  if (errors.length)
    throw new SafetyError(`Planning failed; no protected data changed:\n${errors.join('\n')}`, errors.length)
  return {summaries, mutations, warnings}
}

function operationsFor(mutations: Mutation[], next: SyncState, context: IOContext): FileOperation[] {
  const operations: FileOperation[] = mutations.map((mutation) => {
    if (mutation.type === MT.FILE_WRITE)
      return {
        path: mutation.path,
        content: mutation.content,
        backup: mutation.backup === true,
        private: mutation.backup === true,
      }
    if (mutation.type === MT.FILE_DELETE) return {path: mutation.path, content: null}
    throw new Error(`Unsupported sync operation: ${mutation.type}`)
  })
  // Commit targets/backups, then state, then config; compensation must reverse this metadata boundary.
  operations.push({path: STATE_PATH, content: JSON.stringify(next, null, 2) + '\n', private: true})
  if (context.projectConfig)
    operations.push({
      path: CONFIG_PATH,
      content: serializeProjectConfig({...context.projectConfig, lastSync: next.lastSync}),
      private: true,
    })
  return operations
}

export async function commitPrepared(prepared: Awaited<ReturnType<typeof prepareTransaction>>): Promise<void> {
  try {
    await prepared.commit()
  } catch (error) {
    if (error instanceof TransactionError && error.unrestored.length) {
      // Presentation suppression must never hide a manual recovery requirement.
      console.error(
        redact(
          `Recovery required; unrestored/untrusted paths: ${error.unrestored.join(', ')}. Preserve files/backups and recovery temporaries: ${error.recoveryFiles.join(', ') || '(none)'}. Restore target/config/state from one known-good snapshot, then dry-run. Do not retry writes using untrusted metadata.`,
        ),
      )
    }
    throw error
  }
}

export function prepareSync(
  root: string,
  mutations: Mutation[],
  next: SyncState,
  context: IOContext,
  fs = transactionIO,
) {
  return prepareTransaction(root, operationsFor(mutations, next, context), fs)
}

export function displayPlan(
  summaries: SyncFileSummary[],
  sources: Source[],
  config: SyncConfig,
  dryRun: boolean,
): void {
  if (dryRun) renderer.renderInfo(M.output.wouldSync(sources.map((source) => source.name).join(', ')))
  renderer.renderDim(M.output.strategyBanner(config.source_conflict_strategy, config.local_conflict_strategy))
  for (const [id, files] of Object.entries(Object.groupBy(summaries, (item) => item.assistantId))) {
    renderer.render(`${id === 'unknown' ? 'Other' : getAssistant(id).name}:`)
    files?.forEach((file) => renderer.renderSyncFile(file.targetPath, file.status, dryRun))
  }
  if (dryRun) renderer.renderDim(M.output.dryRunHint)
}
