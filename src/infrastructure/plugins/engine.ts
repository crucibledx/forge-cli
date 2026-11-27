import type {CompileHarnessData, CompileResult} from '@domain/compile'
import {
  applyEmittedVersion,
  compile as compileUnit,
  compileInputs,
  COMPILER_VERSION,
  emittedVersion,
  versionSuffix,
} from '@domain/compile'
import type {CompileConfig} from '@domain/config/types'
import type {
  CompileLockEntry,
  DeliveredFiles,
  LockAction,
  PluginConfig,
  PluginLock,
  PluginLockEntry,
  PluginPackage,
  PluginScope,
} from '@domain/plugins'
import {
  buildPluginLock,
  decideLockAction,
  hashDelivered,
  hashPluginFiles,
  LOCK_ACTIONS,
  lockedSource,
  sourceWarnings,
} from '@domain/plugins'

import {readCachedPlugin} from './cache'
import {checkPluginFiles} from './check'
import {PluginSourceError, PluginValidationError} from './errors'
import type {AcquiredPlugin, PluginSourceContext} from './source'
import {acquirePluginSource} from './source'

/** Produces the files forge delivers for one harness (the emitters of #56/#57). */
export type PluginDeliver = (pkg: PluginPackage) => DeliveredFiles

export interface LockPluginsInput {
  /** The `plugins:` entries of one scope. */
  plugins: readonly PluginConfig[]
  /** That scope's current lock (`emptyPluginLock()` when there is none). */
  lock: PluginLock
  context: PluginSourceContext
  /** That scope's plugin cache root; a matching cached package avoids a fetch. */
  cacheRoot: string
  /** Harnesses a plugin targets when its config lists none: the enabled harnesses. */
  defaultHarnesses: readonly string[]
  /**
   * Disabled harnesses whose settings registration the caller keeps. A previously installed output of one is frozen:
   * its hash carries into the new lock untouched (nothing is re-emitted), so the delivered tree, catalog entry and
   * variant survive exactly as installed while the harness is disabled.
   */
  retain?: readonly string[]
  /** Emitters by harness. A targeted harness without one is reported in `skipped`, not delivered. */
  deliver: Readonly<Partial<Record<string, PluginDeliver>>>
  /**
   * Compile units (spec 0005 §1): one compile per (harness, scope) over everything delivered to that harness,
   * before emission. Harnesses outside `support` emit v0.8 bytes. `compile.enabled: false` is the identity.
   */
  compile?: {
    scope: PluginScope
    config: CompileConfig
    support: Readonly<Partial<Record<string, CompileHarnessData>>>
    /** Test seam; defaults to the domain compile. */
    run?: typeof compileUnit
  }
}

export const SKIP_REASONS = {NO_PLUGIN_SUPPORT: 'no-plugin-support', NOT_IN_MANIFEST: 'not-in-manifest'} as const
export type SkipReason = (typeof SKIP_REASONS)[keyof typeof SKIP_REASONS]

export interface LockedPlugin {
  config: PluginConfig
  entry: PluginLockEntry
  pkg: PluginPackage
  /** `locked`: installed verbatim from the lock; `resolve`: first lock; `relock`: see `reason`. */
  action: LockAction
  reason?: string
  /** Freshly emitted files per harness; only enabled harnesses are ever emitted. */
  outputs: Record<string, DeliveredFiles>
  /** Frozen output hashes carried from the previous lock for retained disabled harnesses (see LockPluginsInput). */
  retainedOutputs: Record<string, string>
  skipped: Array<{harness: string; reason: SkipReason}>
  warnings: string[]
}

export interface LockPluginsResult {
  lock: PluginLock
  plugins: LockedPlugin[]
  /** Names in the previous lock that the config no longer lists. */
  removed: string[]
  /** Per compiled harness: the unit's result, including the manifest rows and link edges. */
  compiles: Record<string, CompileResult>
  /** Per compiled harness: the fresh `compile[<harness>]` lock entry. */
  compileLock: Record<string, CompileLockEntry>
}

interface Acquired {
  config: PluginConfig
  previous?: PluginLockEntry
  action: LockAction
  reason?: string
  pkg: PluginPackage
  contentHash: string
  resolved?: string
  /** Harnesses this plugin is emitted for (targeted, deliverable, not ruled out by its manifest). */
  emitTargets: string[]
  skipped: LockedPlugin['skipped']
  warnings: string[]
}

/**
 * Spec 0003 §4 lock discipline for one scope. Reads sources and the cache but writes nothing forge protects, so a
 * failure (`PluginSourceError`, `PluginValidationError`) aborts before any write; the caller plans the lockfile and
 * cache writes (`serializePluginLock`, `pluginCacheFiles`) from the result.
 */
export async function lockPlugins(input: LockPluginsInput): Promise<LockPluginsResult> {
  const acquired: Acquired[] = []
  for (const config of input.plugins) acquired.push(await acquireOne(config, input))

  // Compile: one unit per (harness, scope), over everything delivered to that harness (spec 0005 §1).
  const compiles: Record<string, CompileResult> = {}
  const compiled = new Map<Acquired, Map<string, CompileResult['packages'][number]>>()
  const units = new Map<string, Acquired[]>()
  if (input.compile?.config.enabled) {
    const run = input.compile.run ?? compileUnit
    for (const plugin of acquired)
      for (const harness of plugin.emitTargets)
        if (input.compile.support[harness] !== undefined) units.set(harness, [...(units.get(harness) ?? []), plugin])
    for (const [harness, unit] of units) {
      const result = run({
        packages: unit.map((plugin) => plugin.pkg),
        harness: harness as never,
        scope: input.compile.scope,
        config: input.compile.config,
      })
      compiles[harness] = result
      result.packages.forEach((compiledPackage, index) => {
        const perPlugin = compiled.get(unit[index]) ?? new Map()
        perPlugin.set(harness, compiledPackage)
        compiled.set(unit[index], perPlugin)
      })
    }
  }

  const plugins = acquired.map((plugin) => emitOne(plugin, input, compiled.get(plugin)))
  const entries = plugins.map((plugin) => plugin.entry)

  // Fresh compile[<harness>] entries: the inputs hash covers the config, harness data, compiler version and the
  // unit's sorted (name, contentHash) pairs (spec 0005 §5).
  const compileLock: Record<string, CompileLockEntry> = {}
  for (const [harness, unit] of units)
    compileLock[harness] = {
      enabled: true,
      inputs: compileInputs({
        config: input.compile!.config,
        harnessData: input.compile!.support[harness],
        compilerVersion: COMPILER_VERSION,
        plugins: unit.map((plugin) => ({name: plugin.config.name, contentHash: plugin.contentHash})),
      }).hash,
      compiler: COMPILER_VERSION,
    }

  const names = new Set(input.plugins.map((plugin) => plugin.name))
  return {
    lock: buildPluginLock(entries),
    plugins,
    removed: input.lock.plugins.filter((entry) => !names.has(entry.name)).map((entry) => entry.name),
    compiles,
    compileLock,
  }
}

async function acquireOne(config: PluginConfig, input: LockPluginsInput): Promise<Acquired> {
  const previous = input.lock.plugins.find((entry) => entry.name === config.name)
  let {action, reason} = decideLockAction(config, previous)
  let acquired: AcquiredPlugin
  if (action !== LOCK_ACTIONS.LOCKED || !previous) acquired = await acquirePluginSource(config, input.context)
  else if (previous.source.type === 'git') acquired = await acquireLocked(config, previous, input)
  else {
    acquired = await acquirePluginSource(config, input.context)
    if (hashPluginFiles(acquired.files) !== previous.contentHash)
      [action, reason] = [LOCK_ACTIONS.RELOCK, 'local content changed']
  }
  const check = checkPluginFiles(acquired.files)
  if (!check.pkg) throw new PluginValidationError(config.name, check.errors)
  const pkg = check.pkg
  if (pkg.manifest.name !== config.name)
    throw new PluginValidationError(config.name, [
      `plugin.json: name "${pkg.manifest.name}" does not match the configured name`,
    ])
  const supported = pkg.manifest.forge.harnesses
  const skipped: LockedPlugin['skipped'] = []
  const emitTargets: string[] = []
  const targeted = new Set(config.harnesses ?? input.defaultHarnesses)
  for (const harness of targeted) {
    if (!input.deliver[harness]) skipped.push({harness, reason: SKIP_REASONS.NO_PLUGIN_SUPPORT})
    else if (supported && !supported.includes(harness)) skipped.push({harness, reason: SKIP_REASONS.NOT_IN_MANIFEST})
    else emitTargets.push(harness)
  }
  return {
    config,
    previous,
    action,
    reason,
    pkg,
    contentHash: hashPluginFiles(acquired.files),
    resolved: acquired.resolved,
    emitTargets,
    skipped,
    warnings: [...sourceWarnings(config), ...check.warnings],
  }
}

async function acquireLocked(config: PluginConfig, entry: PluginLockEntry, input: LockPluginsInput) {
  const acquired: AcquiredPlugin =
    (await readCachedPlugin(input.cacheRoot, entry).then((files) => files && {files, resolved: entry.resolved})) ??
    (await acquirePluginSource(config, input.context, entry.resolved))
  if (hashPluginFiles(acquired.files) !== entry.contentHash)
    throw new PluginSourceError(
      config.name,
      `content at locked commit ${entry.resolved} does not match the lock's contentHash`,
    )
  return acquired
}

function emitOne(
  acquired: Acquired,
  input: LockPluginsInput,
  compiled: Map<string, CompileResult['packages'][number]> | undefined,
): LockedPlugin {
  const outputs: Record<string, DeliveredFiles> = {}
  const emitted: Record<string, string> = {}
  for (const harness of acquired.emitTargets) {
    const deliver = input.deliver[harness]!
    const compiledPackage = compiled?.get(harness)
    const delivered = deliver(compiledPackage?.pkg ?? acquired.pkg)
    if (compiledPackage?.changed) {
      // Compile changed bytes: the emitted version, catalog entry and cache path gain the suffix, computed with
      // the source version in place; outputs then hash the final bytes (spec 0005 §5).
      const style = input.compile!.support[harness]!.versionSuffix
      const version = emittedVersion(acquired.pkg.manifest.version, versionSuffix(hashDelivered(delivered)), style)
      emitted[harness] = version
      outputs[harness] = {...delivered, plugin: applyEmittedVersion(delivered.plugin, version)}
    } else outputs[harness] = delivered
  }
  // Frozen retention: a retained disabled harness keeps its previous output hash instead of a fresh emission,
  // so its delivered files stay valid while its registration is retained (docs/safety-contract.md).
  const retainedOutputs: Record<string, string> = {}
  for (const harness of input.retain ?? []) {
    const hash = acquired.previous?.outputs[harness]
    if (hash !== undefined && outputs[harness] === undefined) retainedOutputs[harness] = hash
  }
  const entry: PluginLockEntry = {
    name: acquired.config.name,
    version: acquired.pkg.manifest.version,
    source: lockedSource(acquired.config.source),
    ...(acquired.resolved === undefined ? {} : {resolved: acquired.resolved}),
    contentHash: acquired.contentHash,
    outputs: {
      ...Object.fromEntries(Object.entries(outputs).map(([harness, files]) => [harness, hashDelivered(files)])),
      ...retainedOutputs,
    },
    ...(Object.keys(emitted).length ? {emitted} : {}),
  }
  return {
    config: acquired.config,
    entry,
    pkg: acquired.pkg,
    action: acquired.action,
    reason: acquired.reason,
    outputs,
    retainedOutputs,
    skipped: acquired.skipped,
    warnings: acquired.warnings,
  }
}
