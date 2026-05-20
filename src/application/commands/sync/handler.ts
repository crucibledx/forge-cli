import {existsSync} from 'node:fs'
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'

import {groupBy} from 'lodash-es'

import type {AssistantDefinition, AssistantId} from '@domain/assistants'
import {getAssistant} from '@domain/assistants'
import {mergeConfigs} from '@domain/config/merge'
import type {ProjectConfig, Source} from '@domain/config/types'
import {resolveTargets} from '@domain/sync/resolver'
import {Mutation, ResolvedTarget, SyncFileStatus, SyncFileSummary} from '@domain/sync/types'
import * as renderer from '@infrastructure/cli/renderer'
import {writeProjectConfig} from '@infrastructure/config'
import {applyMutations, collectFiles, rollbackMutations} from '@infrastructure/fs'
import type {IOContext} from '@infrastructure/io'
import io from '@infrastructure/io'
import {getSourceLoader} from '@infrastructure/source'

import {SYNC_MESSAGES as M} from './messages'
import type {SyncCommandAction} from './types'

export const runSync: SyncCommandAction = async (options) => {
  const projectRoot = io.resolveProjectRoot()
  const context = await io.buildContext(projectRoot)
  const config = mergeConfigs(context.globalConfig, context.projectConfig)

  validateConfig(config)

  const assistantDefs = config.assistants.map((a) => getAssistant(a.id))
  const resolved = await fetchAndResolve(config.sources, assistantDefs)

  if (resolved.length === 0) {
    renderer.renderWarning(M.warnings.noFilesToSync)
    return
  }

  const {summaries, mutations} = await buildPlan(projectRoot, resolved)

  displayPlan(summaries, config.sources, options.dryRun)

  if (options.dryRun) return

  await executePlan(projectRoot, mutations, context)
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

    const resolved = resolveTargets(sourceFiles, assistantDefs)

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
): Promise<{summaries: SyncFileSummary[]; mutations: Mutation[]}> {
  const summaries: SyncFileSummary[] = []
  const mutations: Mutation[] = []

  for (const target of resolved) {
    try {
      const fullPath = join(projectRoot, target.targetPath)
      let status: SyncFileStatus = 'new'

      if (existsSync(fullPath)) {
        const existing = await readFile(fullPath, 'utf-8')
        status = existing === target.content ? 'no_change' : 'update'
      }

      summaries.push({
        targetPath: target.targetPath,
        sourcePath: target.sourcePath,
        assistantId: target.assistantId,
        status,
      })

      if (status !== 'no_change') {
        mutations.push({type: 'file_write', path: target.targetPath, content: target.content})
      }
    } catch (err) {
      summaries.push({
        targetPath: target.targetPath,
        sourcePath: target.sourcePath,
        assistantId: target.assistantId,
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return {summaries, mutations}
}

export function displayPlan(summaries: SyncFileSummary[], sources: Source[], dryRun: boolean): void {
  const byAssistant = groupBy(summaries, (item) => item.assistantId)
  const sourceNames = sources.map((s) => s.name).join(', ')

  if (dryRun) {
    renderer.renderInfo(M.output.wouldSync(sourceNames))
    renderer.renderNewline()
  }

  for (const [assistantId, files] of Object.entries(byAssistant)) {
    const def = getAssistant(assistantId as AssistantId)
    renderer.render(`${def.name}:`)
    for (const file of files) {
      renderer.renderSyncFile(file.targetPath, file.status, dryRun)
    }
    renderer.renderNewline()
  }

  const errorCount = summaries.filter((s) => s.status === 'error').length
  if (errorCount > 0) {
    renderer.renderWarning(M.summary.errors(errorCount))
  }

  if (dryRun) {
    renderer.renderDim(M.output.dryRunHint)
  }
}

export async function executePlan(projectRoot: string, mutations: Mutation[], context: IOContext): Promise<void> {
  const applied = await applyMutations(projectRoot, mutations)
  const failed = applied.find((a) => !a.success)

  if (failed) {
    renderer.renderError(M.errors.applyFailed(failed.error ?? 'Unknown error'))
    renderer.renderDim(M.progress.rollingBack)
    await rollbackMutations(projectRoot, applied)
    renderer.renderDim(M.progress.rollbackComplete)
    process.exit(1)
  }

  if (context.projectConfig) {
    await writeProjectConfig(projectRoot, {
      ...context.projectConfig,
      lastSync: new Date().toISOString(),
    })
  }

  const sourceNames = context.projectConfig?.sources?.map((s) => s.name).join(', ') ?? ''
  const changeCount = mutations.length
  renderer.renderSuccess(M.output.done(changeCount, sourceNames))
  renderer.renderDim(M.output.lastSync(new Date().toISOString()))
}
