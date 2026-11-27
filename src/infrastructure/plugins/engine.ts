import type {
  DeliveredFiles,
  LockAction,
  PluginConfig,
  PluginLock,
  PluginLockEntry,
  PluginPackage,
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
}

/**
 * Spec 0003 §4 lock discipline for one scope. Reads sources and the cache but writes nothing forge protects, so a
 * failure (`PluginSourceError`, `PluginValidationError`) aborts before any write; the caller plans the lockfile and
 * cache writes (`serializePluginLock`, `pluginCacheFiles`) from the result.
 */
export async function lockPlugins(input: LockPluginsInput): Promise<LockPluginsResult> {
  const plugins: LockedPlugin[] = []
  for (const config of input.plugins) plugins.push(await lockPlugin(config, input))
  const names = new Set(input.plugins.map((plugin) => plugin.name))
  return {
    lock: buildPluginLock(plugins.map((plugin) => plugin.entry)),
    plugins,
    removed: input.lock.plugins.filter((entry) => !names.has(entry.name)).map((entry) => entry.name),
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

async function lockPlugin(config: PluginConfig, input: LockPluginsInput): Promise<LockedPlugin> {
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
  const outputs: Record<string, DeliveredFiles> = {}
  const targeted = new Set(config.harnesses ?? input.defaultHarnesses)
  for (const harness of targeted) {
    const deliver = input.deliver[harness]
    if (!deliver) skipped.push({harness, reason: SKIP_REASONS.NO_PLUGIN_SUPPORT})
    else if (supported && !supported.includes(harness)) skipped.push({harness, reason: SKIP_REASONS.NOT_IN_MANIFEST})
    else outputs[harness] = deliver(pkg)
  }
  // Frozen retention: a retained disabled harness keeps its previous output hash instead of a fresh emission,
  // so its delivered files stay valid while its registration is retained (docs/safety-contract.md).
  const retainedOutputs: Record<string, string> = {}
  for (const harness of input.retain ?? []) {
    const hash = previous?.outputs[harness]
    if (hash !== undefined && outputs[harness] === undefined) retainedOutputs[harness] = hash
  }
  const entry: PluginLockEntry = {
    name: config.name,
    version: pkg.manifest.version,
    source: lockedSource(config.source),
    ...(acquired.resolved === undefined ? {} : {resolved: acquired.resolved}),
    contentHash: hashPluginFiles(acquired.files),
    outputs: {
      ...Object.fromEntries(Object.entries(outputs).map(([harness, files]) => [harness, hashDelivered(files)])),
      ...retainedOutputs,
    },
  }
  return {
    config,
    entry,
    pkg,
    action,
    reason,
    outputs,
    retainedOutputs,
    skipped,
    warnings: [...sourceWarnings(config), ...check.warnings],
  }
}
