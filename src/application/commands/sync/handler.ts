import {stat} from 'node:fs/promises'
import {homedir} from 'node:os'
import {join, relative} from 'node:path'

import type {ProjectConfig, Source, SyncConfig} from '@domain/config/types'
import {SYNC_CONFIG_DEFAULTS} from '@domain/config/types'
import type {HarnessDefinition} from '@domain/harnesses'
import {
  findUndelivered,
  getAllHarnesses,
  getHarness,
  resolveHarnessByPath,
  resolveHarnessBySettingsPath,
} from '@domain/harnesses'
import {PLUGIN_SCOPES} from '@domain/plugins'
import {redact} from '@domain/redact'
import {isGlobalMode} from '@domain/scope'
import {detectLocalConflict} from '@domain/sync/conflict'
import {resolveSourceConflicts, SourceConflictError} from '@domain/sync/merge'
import {CONFIG_PATH, STATE_PATH, validatePathGraph} from '@domain/sync/plan'
import {reconcileState} from '@domain/sync/reconcile'
import {resolveTargets} from '@domain/sync/resolver'
import type {SyncState, SyncStateEntry} from '@domain/sync/state'
import {hashContent, isKeyedEntry, keyedStateEntry, withKeyedEntries} from '@domain/sync/state'
import type {Mutation, ResolvedTarget, SyncFileSummary} from '@domain/sync/types'
import {MUTATION_TYPES as MT, SYNC_FILE_STATUSES as S} from '@domain/sync/types'
import * as renderer from '@infrastructure/cli/renderer'
import {convertAssistantsAlias, loadSyncState, serializeProjectConfig} from '@infrastructure/config'
import type {KeyedValue} from '@infrastructure/config/keyed-merge'
import {DRIFT_POLICIES, mergeKeyed} from '@infrastructure/config/keyed-merge'
import {createConfinement} from '@infrastructure/fs/confinement'
import {createFileReader} from '@infrastructure/fs/reader'
import type {FileOperation, TransactionIO} from '@infrastructure/fs/transaction'
import {prepareTransaction, reportUnrestoredRecovery, transactionIO} from '@infrastructure/fs/transaction'
import type {IOContext, IOService} from '@infrastructure/io'
import io from '@infrastructure/io'
import {createFileLogger} from '@infrastructure/logger'
import {removeEmptyCacheDirs} from '@infrastructure/plugins'
import type {ReportService} from '@infrastructure/report'
import {loadSourceFiles} from '@infrastructure/source'
import {setTelemetryContext} from '@infrastructure/telemetry'

import {CommandError} from '../types'
import {SafetyError} from './errors'
import {SYNC_MESSAGES as M} from './messages'
import {persistOutcome} from './outcome'
import type {ManagedFile} from './plugins'
import {planPlugins, pluginInstallExists, renderPluginReport, validatePluginScopes} from './plugins'
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
    const scope = isGlobalMode() ? PLUGIN_SCOPES.USER : PLUGIN_SCOPES.PROJECT
    // A previous plugin install makes an empty config valid: this run removes what the install left.
    validateConfig(config, true, await pluginInstallExists(boundary.root, scope))
    validatePluginScopes(config.plugins ?? [], scope)
    const enabled = new Set(config.harnesses.filter((harness) => harness.enabled).map((harness) => harness.id))
    const definitions = [...enabled].map(getHarness)
    logger.info('sync acquisition started', {
      sources: config.sources.map((source) => source.name),
      harnesses: [...enabled],
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
    const plugins = await planPlugins({
      root: boundary.root,
      home: homedir(),
      scope,
      plugins: config.plugins ?? [],
      enabled,
    })
    const state = await loadSyncState(boundary.root)
    const {summaries, mutations, warnings, overridden, keyed} = await buildPlan(
      boundary.root,
      resolved,
      state,
      syncConfig,
      enabled,
      {force: Boolean(options.force), keyed: plugins.keyed, files: plugins.files, prune: plugins.prune},
    )
    warnings.forEach(renderer.renderWarning)
    displayPlan(summaries, config.sources, syncConfig, options.dryRun)
    overridden.forEach((item) => renderer.renderWarning(M.output.forced(item)))
    const next = withKeyedEntries(reconcileState(state, resolved, summaries, new Date().toISOString()), keyed)
    // Test-only commit-failure injection (e2e AC-14): wraps the transaction's replace so the named operation
    // fails after every earlier operation — the keyed settings merge included — has landed, sending the commit
    // through the rollback path. It fires once: compensation restores a pre-existing target through the same
    // replace, and refusing that restore would break the rollback it is meant to exercise. The target resolves
    // through the sync boundary; the wrapper changes nothing itself, it only refuses the one replace.
    const failCommit = process.env.FORGE_TEST_FAIL_COMMIT
    let syncFs = dependencies.transaction
    if (failCommit !== undefined) {
      const target = await boundary.resolve(failCommit)
      const base = dependencies.transaction ?? transactionIO
      const replaced: string[] = []
      let fired = false
      syncFs = {
        ...base,
        replace: async (temp: string, path: string, existed: boolean) => {
          const rel = relative(boundary.root, path).replaceAll('\\', '/')
          if (path === target && !fired) {
            fired = true
            throw new Error(`Injected commit failure at ${rel} after replacing: ${replaced.join(', ') || '(nothing)'}`)
          }
          replaced.push(rel)
          await base.replace(temp, path, existed)
        },
      }
    }
    // Preparation validates preview write/access feasibility too; never move it below the dry-run return.
    const prepared = await prepareSync(boundary.root, mutations, next, context, syncFs)
    if (options.dryRun) {
      if (plugins.report) renderPluginReport(plugins.report, true)
      return
    }
    const alias = await convertAssistantsAlias(boundary.root, dependencies.transaction)
    try {
      await commitPrepared(prepared)
    } catch (error) {
      // A failed compensation is an emergency: report it even when --silent suppresses warnings.
      await alias?.undo?.().catch(() => console.error(M.errors.aliasUndoFailed))
      throw error
    }
    const synced = summaries.filter(
      (summary) => summary.status === S.NEW || summary.status === S.UPDATE || summary.status === S.DELETED,
    ).length
    setTelemetryContext({file_count: synced})
    if (config.sources.length)
      renderer.renderSuccess(M.output.done(synced, config.sources.map((source) => source.name).join(', ')))
    renderer.renderDim(M.output.lastSync(next.lastSync))
    await removeEmptyCacheDirs(
      join(boundary.root, plugins.cacheDir),
      plugins.prune.map((path) => path.slice(plugins.cacheDir.length + 1)),
    )
    if (plugins.report) renderPluginReport(plugins.report, false)
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

export function validateConfig(config: ProjectConfig, configExists = false, hasInstalledPlugins = false): void {
  if (!config.sources.length && !config.plugins?.length && !hasInstalledPlugins)
    throw new CommandError(M.errors.noSource, configExists ? M.errors.noSourceHintExisting : M.errors.noSourceHint)
  if (!config.harnesses.some((harness) => harness.enabled))
    throw new CommandError(M.errors.noHarnesses, M.errors.noHarnessesHint)
}

export async function fetchAndResolve(
  sources: Source[],
  definitions: HarnessDefinition[],
  load = loadSourceFiles,
): Promise<ResolvedTarget[]> {
  const outcomes = await Promise.allSettled(
    sources.map(async (source) => {
      const files = await load(source)
      return {
        targets: resolveTargets(files, definitions, source.name, source.layout),
        paths: source.layout === 'pre-structured' ? [] : files.map((file) => file.relativePath),
      }
    }),
  )
  const resolved: ResolvedTarget[] = []
  const sourcePaths: string[] = []
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
      renderer.renderDim(`Acquired "${name}": ${outcome.value.targets.length} resolved targets (not yet installed).`)
      resolved.push(...outcome.value.targets)
      sourcePaths.push(...outcome.value.paths)
    }
  }
  if (errors.length)
    throw new SafetyError(`Source acquisition failed; no protected data changed:\n${errors.join('\n')}`, errors.length)
  for (const {harnessId, sourceGlob} of findUndelivered(sourcePaths, definitions))
    renderer.renderWarning(M.output.notDelivered(getHarness(harnessId).name, sourceGlob))
  return resolved
}

/** Settings keys forge should own in one shared JSON/JSONC file after this run. */
export interface KeyedFile {
  path: string
  sourceName: string
  values: KeyedValue[]
}

export interface PlanOptions {
  /** Overwrite drifted forge-owned files and keys, over any configured local conflict strategy. */
  force?: boolean
  keyed?: KeyedFile[]
  /** Forge-owned files written whole and not tracked in state (plugin lockfile, cache and catalogs). */
  files?: ManagedFile[]
  /** Forge-owned untracked files to delete when present. */
  prune?: string[]
}

export async function buildPlan(
  root: string,
  targets: ResolvedTarget[],
  state: SyncState,
  config: SyncConfig,
  enabled = new Set(getAllHarnesses().map((harness) => harness.id)),
  options: PlanOptions = {},
): Promise<{
  summaries: SyncFileSummary[]
  mutations: Mutation[]
  warnings: string[]
  overridden: string[]
  keyed: Record<string, SyncStateEntry | null>
}> {
  const summaries: SyncFileSummary[] = []
  const mutations: Mutation[] = []
  const warnings: string[] = []
  const overridden: string[] = []
  const errors: string[] = []
  const backups: string[] = []
  const read = await createFileReader(root)
  const selected = targets.filter((target) => enabled.has(target.harnessId))
  const paths = selected.map((target) => target.targetPath)
  const desired = new Set(paths)
  const keyedFiles = options.keyed ?? []
  const managed = options.files ?? []
  const prune = options.prune ?? []
  const claimed = new Set([...paths, ...keyedFiles.map((file) => file.path)])
  const keyedPaths = [
    ...new Set([
      ...keyedFiles.map((file) => file.path),
      ...Object.entries(state.files)
        .filter(([, entry]) => isKeyedEntry(entry))
        .map(([path]) => path),
    ]),
  ]
  const graph = [
    ...paths,
    ...keyedFiles.map((file) => file.path),
    ...managed.map((file) => file.path),
    ...prune,
    ...Object.keys(state.files).filter((path) => !claimed.has(path)),
    STATE_PATH,
    CONFIG_PATH,
  ]
  // Validate desired/state/metadata aliases before planning can read any candidate.
  validatePathGraph(graph)
  const active = selected.filter((target) => {
    const owner = resolveHarnessByPath(target.targetPath)
    if (owner?.id === target.harnessId && enabled.has(owner.id)) return true
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
    if (options.force) {
      overridden.push(path)
      return S.UPDATE
    }
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
        harnessId: target.harnessId,
        status,
      })
      if (status === S.NEW || status === S.UPDATE)
        mutations.push({type: MT.FILE_WRITE, path: target.targetPath, content: target.content})
    } catch (error) {
      errors.push(`${target.targetPath}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  for (const [path, entry] of Object.entries(state.files)) {
    if (desired.has(path) || isKeyedEntry(entry)) continue
    const owner = resolveHarnessByPath(path)
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
      summaries.push({targetPath: path, sourcePath: '', harnessId: owner.id, status: skip ? S.SKIPPED : S.DELETED})
    } catch (error) {
      errors.push(`${path}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  // POSIX only: an executable-bit change with identical bytes must still rewrite the file (mode-only repair).
  const executableMode = async (path: string): Promise<boolean | undefined> => {
    if (process.platform === 'win32') return undefined
    const info = await stat(join(root, path)).catch(() => null)
    return info === null ? undefined : (info.mode & 0o111) !== 0
  }
  for (const file of managed) {
    const existing = await read(file.path)
    const mode = await executableMode(file.path)
    const modeDiffers = mode !== undefined && mode !== (file.executable === true)
    if (existing === null || !existing.equals(Buffer.from(file.content)) || modeDiffers)
      mutations.push({type: MT.FILE_WRITE, path: file.path, content: file.content, executable: file.executable})
  }
  for (const path of prune) if ((await read(path)) !== null) mutations.push({type: MT.FILE_DELETE, path})
  // Keyed cleanup ignores keep_local: forge removes the keys it no longer declares, never the shared file.
  const keyed: Record<string, SyncStateEntry | null> = {}
  for (const path of keyedPaths) {
    try {
      const file = keyedFiles.find((item) => item.path === path)
      const entry = state.files[path]
      if (!file) {
        const owner = resolveHarnessBySettingsPath(path)
        if (!owner || !enabled.has(owner.id)) {
          warnings.push(`Retaining tracked path with disabled, unknown or ambiguous ownership: ${path}`)
          keyed[path] = entry
          continue
        }
      }
      if (desired.has(path)) throw new Error('A synced file and a keyed merge target the same path')
      if (entry && !isKeyedEntry(entry)) throw new Error('Tracked as a whole forge-owned file; keyed merge refused')
      const existing = await read(path)
      const result = mergeKeyed({
        text: existing === null ? null : existing.toString('utf8'),
        owned: entry?.ownedKeys ?? {},
        desired: file?.values ?? [],
        drift: options.force ? DRIFT_POLICIES.OVERWRITE : DRIFT_POLICIES.BLOCK,
      })
      overridden.push(...result.drifted.map((key) => `${path} ${key}`))
      if (result.drifted.length && existing !== null && config.backup) await backup(path, existing)
      if (result.content !== null) mutations.push({type: MT.KEYED_MERGE, path, base: existing, content: result.content})
      keyed[path] = keyedStateEntry(file?.sourceName ?? entry!.sourceName, result.owned)
    } catch (error) {
      errors.push(`${path}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  // Recheck after generated backups exist: the first graph cannot detect .bak collisions.
  validatePathGraph([...graph, ...backups])
  if (errors.length)
    throw new SafetyError(`Planning failed; no protected data changed:\n${errors.join('\n')}`, errors.length)
  return {summaries, mutations, warnings, overridden, keyed}
}

function operationsFor(mutations: Mutation[], next: SyncState, context: IOContext): FileOperation[] {
  const operations: FileOperation[] = mutations.map((mutation) => {
    if (mutation.type === MT.FILE_WRITE)
      return {
        path: mutation.path,
        content: mutation.content,
        backup: mutation.backup === true,
        private: mutation.backup === true,
        executable: mutation.executable,
      }
    if (mutation.type === MT.FILE_DELETE) return {path: mutation.path, content: null}
    if (mutation.type === MT.KEYED_MERGE) return {path: mutation.path, content: mutation.content, expect: mutation.base}
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
    reportUnrestoredRecovery(error)
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
  for (const [id, files] of Object.entries(Object.groupBy(summaries, (item) => item.harnessId))) {
    renderer.render(`${id === 'unknown' ? 'Other' : getHarness(id).name}:`)
    files?.forEach((file) => renderer.renderSyncFile(file.targetPath, file.status, dryRun))
  }
  if (dryRun) renderer.renderDim(M.output.dryRunHint)
}
