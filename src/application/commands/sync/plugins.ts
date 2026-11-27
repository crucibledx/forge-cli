import {existsSync} from 'node:fs'
import {join} from 'node:path'

import {getHarness} from '@domain/harnesses'
import type {PluginConfig, PluginHarnessId, PluginLock, PluginScope} from '@domain/plugins'
import {
  FACTORY_PRINT_RULES_FILE,
  LOCK_ACTIONS,
  PLUGIN_EMITTERS,
  PLUGIN_HARNESS_IDS,
  PLUGIN_HARNESSES,
  PLUGIN_SCOPES,
  portabilityReport,
} from '@domain/plugins'
import type {ResolvedTarget} from '@domain/sync/types'
import * as renderer from '@infrastructure/cli/renderer'
import type {KeyedValue} from '@infrastructure/config/keyed-merge'
import {executableOnPath} from '@infrastructure/fs'
import type {LockedPlugin} from '@infrastructure/plugins'
import {
  CACHE_GITIGNORE,
  listCacheFiles,
  lockPlugins,
  MARKETPLACE_CATALOGS,
  marketplaceCatalog,
  marketplaceName,
  PLUGIN_CACHE_DIRS,
  PLUGIN_LOCK_PATHS,
  PLUGIN_REGISTRARS,
  pluginCacheFiles,
  readPluginLock,
  serializePluginLock,
  SKIP_REASONS,
} from '@infrastructure/plugins'

import {CommandError} from '../types'
import {SYNC_MESSAGES} from './messages'

const M = SYNC_MESSAGES.plugins
export const PLUGIN_SOURCE_NAME = 'plugins'

/** A forge-owned file written whole and not tracked in sync state: the lockfile, cache files and catalogs. */
export interface ManagedFile {
  path: string
  content: string | Uint8Array
  executable?: boolean
}

export interface PluginReport {
  scope: PluginScope
  marketplace: string
  plugins: LockedPlugin[]
  removed: string[]
  variants: PluginLock['variants']
}

export interface PluginPlan {
  files: ManagedFile[]
  /** Cache files to delete, relative to the sync root. */
  prune: string[]
  keyed: Array<{path: string; sourceName: string; values: KeyedValue[]}>
  /** Rule files delivered outside the plugin (Claude Code), synced and tracked like any other target. */
  targets: ResolvedTarget[]
  cacheDir: string
  report: PluginReport | null
}

/**
 * True when an earlier sync left a plugin install behind in this scope (lock entries or cache files), so a config
 * without sources or plugins is still a valid sync: it removes what the install left.
 */
export async function pluginInstallExists(root: string, scope: PluginScope): Promise<boolean> {
  const lock = await readPluginLock(join(root, PLUGIN_LOCK_PATHS[scope]))
  return lock.plugins.length > 0 || (await listCacheFiles(join(root, PLUGIN_CACHE_DIRS[scope]))).length > 0
}

/** A plugin's scope must match the config that declares it: one sync root is one transaction. */
export function validatePluginScopes(plugins: readonly PluginConfig[], scope: PluginScope): void {
  const misplaced = plugins.find((plugin) => (plugin.scope ?? scope) !== scope)
  if (!misplaced) return
  if (scope === PLUGIN_SCOPES.PROJECT) throw new CommandError(M.userInProject(misplaced.name), M.userInProjectHint)
  throw new CommandError(M.projectInUser(misplaced.name), M.projectInUserHint)
}

/**
 * Spec 0003 §4–§5 for one scope: lock, emit, cache, catalogs and registrar keys. Acquires and validates every plugin
 * before returning, so any source or validation error aborts the sync before a write.
 */
export async function planPlugins(input: {
  root: string
  home: string
  scope: PluginScope
  plugins: readonly PluginConfig[]
  enabled: ReadonlySet<string>
  /** Test seam for the node prerequisite check; defaults to the runtime's PATH resolver. */
  hasExecutable?: (name: string) => boolean | Promise<boolean>
}): Promise<PluginPlan> {
  const {root, scope} = input
  const cacheDir = PLUGIN_CACHE_DIRS[scope]
  const cacheRoot = join(root, cacheDir)
  const lockPath = PLUGIN_LOCK_PATHS[scope]
  const lock = await readPluginLock(join(root, lockPath))
  const cached = await listCacheFiles(cacheRoot)
  const empty: PluginPlan = {files: [], prune: [], keyed: [], targets: [], cacheDir, report: null}
  if (!input.plugins.length && !lock.plugins.length && !cached.length) return empty

  const capable = [...input.enabled].map(getHarness).filter((harness) => harness.plugin)
  // Only enabled harnesses are delivered to; emitter availability is not installation eligibility. A disabled
  // harness keeps what it installed through frozen retention below, never through fresh emission.
  const deliver = Object.fromEntries(
    capable.map((harness) => {
      const emitter = PLUGIN_EMITTERS[harness.plugin!.emit]
      if (!emitter) throw new Error(`${harness.name} names an unknown plugin emitter: ${harness.plugin!.emit}`)
      return [harness.id, emitter]
    }),
  )
  const retainedHarnesses = PLUGIN_HARNESS_IDS.filter((harness) => !input.enabled.has(harness))
  const result = await lockPlugins({
    plugins: input.plugins,
    lock,
    context: {root, home: input.home},
    cacheRoot,
    defaultHarnesses: [...input.enabled],
    retain: retainedHarnesses,
    deliver,
  })
  // The generated Droid rules hook spawns node; fail before any write when a supported standalone install lacks it.
  const rulesPlugins = result.plugins
    .filter((plugin) =>
      plugin.outputs[PLUGIN_HARNESSES.DROID]?.plugin.some((file) => file.path === FACTORY_PRINT_RULES_FILE),
    )
    .map((plugin) => plugin.entry.name)
  if (rulesPlugins.length && !(await (input.hasExecutable ?? executableOnPath)('node')))
    throw new CommandError(M.nodeRequired(rulesPlugins.join(', ')), M.nodeRequiredHint)
  const marketplace = marketplaceName(scope, root)

  // Frozen retention (docs/safety-contract.md): a disabled harness keeps the delivered tree and catalog entry
  // its retained settings keys point at, even for a plugin the config no longer lists. The tree is pruned once
  // ownership permits cleanup: the harness is enabled again, or the keys are gone.
  const frozenPrefixes = lock.plugins.flatMap((entry) =>
    retainedHarnesses
      .filter((harness) => entry.outputs[harness] !== undefined)
      .map((harness) => `${entry.name}/${entry.version}/${harness}/`),
  )
  const isFrozen = (path: string) => frozenPrefixes.some((prefix) => path.startsWith(prefix))

  const desired = new Map<string, ManagedFile>()
  const entries = result.plugins.map((plugin) => plugin.entry)
  for (const plugin of result.plugins)
    for (const file of pluginCacheFiles(plugin.entry, plugin.pkg.files, plugin.outputs)) desired.set(file.path, file)
  if (!result.plugins.length && !frozenPrefixes.length) desired.delete(CACHE_GITIGNORE.path)
  else
    for (const harness of PLUGIN_HARNESS_IDS)
      desired.set(MARKETPLACE_CATALOGS[harness], {
        path: MARKETPLACE_CATALOGS[harness],
        content: marketplaceCatalog(
          marketplace,
          harness,
          // An enabled harness lists what this sync delivered; a disabled one keeps the frozen entries its
          // retained settings keys resolve against.
          (input.enabled.has(harness) ? entries : lock.plugins).filter((entry) => entry.outputs[harness] !== undefined),
        ),
      })

  const files: ManagedFile[] = [...desired.values()].map((file) => ({
    path: join(cacheDir, file.path),
    content: file.content,
    executable: file.executable === true,
  }))
  if (input.plugins.length || existsSync(join(root, lockPath)))
    files.push({path: lockPath, content: serializePluginLock(result.lock)})

  const keyed: PluginPlan['keyed'] = []
  for (const harness of capable) {
    const names = entries.filter((entry) => entry.outputs[harness.id] !== undefined).map((entry) => entry.name)
    if (!names.length) continue
    const register = PLUGIN_REGISTRARS[harness.plugin!.register]
    if (!register) throw new Error(`${harness.name} names an unknown plugin registrar: ${harness.plugin!.register}`)
    const registration = register({scope, marketplace, cacheRoot, plugins: names})
    keyed.push({path: registration.path, sourceName: PLUGIN_SOURCE_NAME, values: registration.values})
  }

  return {
    files,
    prune: cached.filter((path) => !desired.has(path) && !isFrozen(path)).map((path) => join(cacheDir, path)),
    keyed,
    targets: ruleTargets(result.plugins, scope),
    cacheDir,
    report: {scope, marketplace, plugins: result.plugins, removed: result.removed, variants: result.lock.variants},
  }
}

const decoder = new TextDecoder()

/**
 * Spec 0003 §2: a harness that loads plugin rules from its own rules directory gets them as forge-owned files there,
 * so drift, `keep_local` and removal follow the loose-resource lifecycle. The sync root is home in a user sync.
 */
function ruleTargets(plugins: readonly LockedPlugin[], scope: PluginScope): ResolvedTarget[] {
  return plugins.flatMap((plugin) =>
    Object.entries(plugin.outputs).flatMap(([harnessId, delivered]) => {
      if (!delivered.claudeRules?.length) return []
      const harness = getHarness(harnessId)
      const rule = harness.components.rule
      const dir = scope === PLUGIN_SCOPES.USER ? rule?.global?.replace(/^~\//, '') : rule?.project
      if (!dir) throw new Error(`${harness.name} has no ${scope} rules directory for plugin rule files`)
      return delivered.claudeRules.map((file) => ({
        sourcePath: `${plugin.entry.name}/${file.path}`,
        targetPath: `${dir}${file.path}`,
        content: decoder.decode(file.content),
        harnessId,
        sourceName: PLUGIN_SOURCE_NAME,
      }))
    }),
  )
}

const ACTIONS = {
  [LOCK_ACTIONS.RESOLVE]: () => M.resolved,
  [LOCK_ACTIONS.LOCKED]: () => M.locked,
  [LOCK_ACTIONS.RELOCK]: (reason?: string) => M.relocked(reason ?? 'source descriptor changed'),
}

/** Spec 0003 §4: the sync report ends with the installed plugin set, per-harness status and the variants. */
export function renderPluginReport(report: PluginReport, dryRun: boolean): void {
  report.plugins.forEach((plugin) => plugin.warnings.forEach(renderer.renderWarning))
  renderer.render(M.header(report.scope, report.marketplace, dryRun))
  for (const plugin of report.plugins) {
    const {name, version} = plugin.entry
    renderer.render(`  ${name} ${version}: ${ACTIONS[plugin.action](plugin.reason)}`)
    const portability = portabilityReport(plugin.pkg)
    for (const harness of Object.keys(plugin.outputs)) {
      const definition = getHarness(harness)
      renderer.render(`    ${definition.name}: ${M.installed(`${name}@${report.marketplace}`)}`)
      if (definition.plugin?.installNote)
        renderer.renderDim(`      ${definition.name} ${definition.plugin.installNote}`)
      for (const entry of portability[harness as PluginHarnessId] ?? [])
        renderer.renderDim(`      ${entry.status} ${entry.kind} ${entry.name}: ${entry.detail}`)
    }
    for (const {harness, reason} of plugin.skipped) {
      const definition = getHarness(harness)
      const line =
        reason === SKIP_REASONS.NOT_IN_MANIFEST
          ? M.notInManifest(name, definition.name)
          : definition.plugin
            ? M.notEnabled(definition.name)
            : M.notSupported(definition.name)
      renderer.render(`    ${definition.name}: ${line}`)
    }
  }
  report.removed.forEach((name) => renderer.render(`  ${name}: ${M.removed}`))
  const variants = Object.entries(report.variants)
  if (variants.length) {
    renderer.render(M.variants)
    variants.forEach(([harness, variant]) => renderer.render(`  ${harness}: ${variant}`))
  }
}
