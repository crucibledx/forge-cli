import {existsSync} from 'node:fs'
import {join} from 'node:path'

import type {compile as compileUnit, CompileHarnessData} from '@domain/compile'
import {
  COMPILE_STATUSES,
  COMPILE_SUPPORT,
  compileManifestDocument,
  COMPILER_VERSION,
  serializeCompileManifest,
} from '@domain/compile'
import type {CompileConfigInput} from '@domain/config/types'
import {effectiveCompileConfig} from '@domain/config/types'
import {getHarness} from '@domain/harnesses'
import type {CompileLockEntry, PluginConfig, PluginHarnessId, PluginLock, PluginScope} from '@domain/plugins'
import {
  buildPluginLock,
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
  COMPILE_MANIFEST_DIRS,
  COMPILE_MANIFEST_GITIGNORE,
  listCacheFiles,
  listCompileManifests,
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

/** One compile outcome line of the sync report (spec 0005 §5 sync discipline). */
export interface CompileNote {
  harness: string
  /** One-time v0.8 upgrade message, with the unit's status counts. */
  upgrade?: {listed: number; deferred: number}
  /** `inputs` changed: the named input that changed. */
  recompiled?: string
  /** Enabled and compile-capable, but compile has no support for it yet. */
  unsupported?: boolean
}

export interface PluginReport {
  scope: PluginScope
  marketplace: string
  plugins: LockedPlugin[]
  removed: string[]
  variants: PluginLock['variants']
  compile: CompileNote[]
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
  /** The scope's raw `compile:` block; defaults apply. */
  compile?: CompileConfigInput
  /** Test seams: compile support data and the compile function itself. */
  compileSupport?: Readonly<Partial<Record<string, CompileHarnessData>>>
  compileRun?: typeof compileUnit
  /** Test seam for the node prerequisite check; defaults to the runtime's PATH resolver. */
  hasExecutable?: (name: string) => boolean | Promise<boolean>
}): Promise<PluginPlan> {
  const {root, scope} = input
  const cacheDir = PLUGIN_CACHE_DIRS[scope]
  const cacheRoot = join(root, cacheDir)
  const lockPath = PLUGIN_LOCK_PATHS[scope]
  const hadLock = existsSync(join(root, lockPath))
  const lock = await readPluginLock(join(root, lockPath))
  const cached = await listCacheFiles(cacheRoot)
  const empty: PluginPlan = {files: [], prune: [], keyed: [], targets: [], cacheDir, report: null}
  if (!input.plugins.length && !lock.plugins.length && !cached.length) return empty

  const compileConfig = effectiveCompileConfig(input.compile)
  const compileSupport = input.compileSupport ?? COMPILE_SUPPORT
  // A newer compiler never relocks: refuse before any write (spec 0005 §5).
  for (const [harness, entry] of Object.entries(lock.compile ?? {}))
    if (entry.compiler > COMPILER_VERSION)
      throw new CommandError(M.lockFromNewerCompiler(harness, entry.compiler, COMPILER_VERSION))

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
    compile: {scope, config: compileConfig, support: compileSupport, run: input.compileRun},
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

  // Sync discipline (spec 0005 §5): decide each harness's compile lock entry, report line and output check.
  const compileNotes: CompileNote[] = []
  const compileMap: Record<string, CompileLockEntry> = {}
  const manifestDir = join(root, COMPILE_MANIFEST_DIRS[scope])
  for (const harness of PLUGIN_HARNESS_IDS) {
    const previous = lock.compile?.[harness]
    const compiled = result.compiles[harness]
    if (!compiled) {
      if (compileConfig.enabled && capable.some((definition) => definition.id === harness) && !compileSupport[harness])
        compileNotes.push({harness, unsupported: true})
      else if (
        !compileConfig.enabled &&
        capable.some((definition) => definition.id === harness) &&
        compileSupport[harness]
      )
        compileMap[harness] = {enabled: false, compiler: COMPILER_VERSION}
      else if (previous) compileMap[harness] = previous
      continue
    }
    compileMap[harness] = result.compileLock[harness]
    const listed = compiled.components.filter((row) => row.status === COMPILE_STATUSES.LISTED).length
    const deferred = compiled.components.filter((row) => row.status === COMPILE_STATUSES.DEFERRED).length
    if (!previous) {
      // The v0.8 upgrade line appears once: when a harness's first compile entry lands on an existing lock.
      if (hadLock) compileNotes.push({harness, upgrade: {listed, deferred}})
    } else if (!previous.enabled) {
      compileNotes.push({harness, recompiled: 'compile re-enabled'})
    } else if (previous.inputs !== result.compileLock[harness].inputs) {
      compileNotes.push({harness, recompiled: recompileReason(previous, lock, result.plugins, harness)})
    } else {
      // Inputs unchanged: the compiler must reproduce the locked outputs byte for byte, else the build is broken.
      for (const plugin of result.plugins) {
        const lockedEntry = lock.plugins.find((entry) => entry.name === plugin.entry.name)
        const lockedHash = lockedEntry?.outputs[harness]
        const freshHash = plugin.entry.outputs[harness]
        if (lockedHash !== undefined && freshHash !== undefined && lockedHash !== freshHash)
          throw new CommandError(
            M.compileMismatch(plugin.entry.name, harness, join(COMPILE_MANIFEST_DIRS[scope], `${harness}.json`)),
          )
      }
    }
  }
  const finalLock = buildPluginLock(
    result.plugins.map((plugin) => plugin.entry),
    Object.keys(compileMap).length ? compileMap : undefined,
  )

  // Frozen retention (docs/safety-contract.md): a disabled harness keeps the delivered tree and catalog entry
  // its retained settings keys point at, even for a plugin the config no longer lists. The tree is pruned once
  // ownership permits cleanup: the harness is enabled again, or the keys are gone.
  const frozenPrefixes = lock.plugins.flatMap((entry) =>
    retainedHarnesses
      .filter((harness) => entry.outputs[harness] !== undefined)
      .map((harness) => `${entry.name}/${entry.emitted?.[harness] ?? entry.version}/${harness}/`),
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
  if (input.plugins.length || hadLock) files.push({path: lockPath, content: serializePluginLock(finalLock)})

  // Compile manifests (spec 0005 §2): one document per compiled harness; stale harness manifests are pruned.
  const manifestFiles = new Map<string, ManagedFile>()
  for (const [harness, compiled] of Object.entries(result.compiles)) {
    const variant = finalLock.variants[harness]
    const inputs = result.compileLock[harness]?.inputs
    if (!variant || !inputs) continue
    manifestFiles.set(`${harness}.json`, {
      path: join(COMPILE_MANIFEST_DIRS[scope], `${harness}.json`),
      content: serializeCompileManifest(
        compileManifestDocument({
          harness: harness as PluginHarnessId,
          scope,
          enabled: true,
          compiler: COMPILER_VERSION,
          inputs,
          components: compiled.components,
          variant,
        }),
      ),
    })
  }
  if (manifestFiles.size)
    manifestFiles.set('.gitignore', {
      path: join(COMPILE_MANIFEST_DIRS[scope], '.gitignore'),
      content: COMPILE_MANIFEST_GITIGNORE.content,
    })
  files.push(...manifestFiles.values())
  const staleManifests = existsSync(manifestDir)
    ? (await listCompileManifests(manifestDir)).filter((name) => !manifestFiles.has(name))
    : []
  const staleGitignore = !manifestFiles.size && existsSync(join(manifestDir, '.gitignore'))

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
    prune: [
      ...cached.filter((path) => !desired.has(path) && !isFrozen(path)).map((path) => join(cacheDir, path)),
      ...staleManifests.map((name) => join(COMPILE_MANIFEST_DIRS[scope], name)),
      ...(staleGitignore ? [join(COMPILE_MANIFEST_DIRS[scope], '.gitignore')] : []),
    ],
    keyed,
    targets: ruleTargets(result.plugins, scope),
    cacheDir,
    report: {
      scope,
      marketplace,
      plugins: result.plugins,
      removed: result.removed,
      variants: finalLock.variants,
      compile: compileNotes,
    },
  }
}

/**
 * Names which compile input changed when a relock happens with an unchanged compiler (spec 0005 §5: the sync
 * line says "recompiled for <harness>: <which input changed>"). Plugin-pair changes win over the config part,
 * matching the order sync acts on them.
 */
function recompileReason(
  previous: CompileLockEntry,
  lock: PluginLock,
  plugins: readonly LockedPlugin[],
  harness: PluginHarnessId,
): string {
  if (previous.compiler !== COMPILER_VERSION)
    return `the compiler version changed (${previous.compiler} -> ${COMPILER_VERSION})`
  const lockedPairs = lock.plugins
    .filter((entry) => entry.outputs[harness] !== undefined)
    .map((entry) => [entry.name, entry.contentHash])
    .sort()
  const currentPairs = plugins
    .filter((plugin) => plugin.entry.outputs[harness] !== undefined)
    .map((plugin) => [plugin.entry.name, plugin.entry.contentHash])
    .sort()
  if (JSON.stringify(lockedPairs) !== JSON.stringify(currentPairs)) return 'the plugin set changed'
  return 'the compile config changed'
}

// Sync targets are text: keep a BOM and refuse bytes that would not survive the round trip, so the installed rule
// is exactly the locked output.
const decoder = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true})

function ruleText(plugin: string, path: string, content: Uint8Array): string {
  try {
    return decoder.decode(content)
  } catch {
    throw new CommandError(M.ruleNotUtf8(plugin, path), M.ruleNotUtf8Hint)
  }
}

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
        content: ruleText(plugin.entry.name, file.path, file.content),
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
  for (const note of report.compile) {
    if (note.unsupported) renderer.render(`  ${M.compileNotSupported(note.harness)}`)
    else if (note.upgrade)
      renderer.render(`  ${M.compileUpgrade(note.harness, note.upgrade.listed, note.upgrade.deferred)}`)
    else if (note.recompiled) renderer.render(`  ${M.recompiled(note.harness, note.recompiled)}`)
  }
  const variants = Object.entries(report.variants)
  if (variants.length) {
    renderer.render(M.variants)
    variants.forEach(([harness, variant]) => renderer.render(`  ${harness}: ${variant}`))
  }
}
