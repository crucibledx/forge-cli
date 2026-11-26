import {hashContent} from '../sync/state'
import {compare} from './package'
import type {PluginConfig, PluginSourceConfig} from './types'

export const PLUGIN_LOCK_VERSION = 1
export const DEFAULT_PLUGIN_REF = 'main'

export type LockedSource = {type: 'local'; path: string} | {type: 'git'; url: string; path?: string; ref: string}

export interface PluginLockEntry {
  name: string
  version: string
  source: LockedSource
  /** Commit SHA a git `ref` resolved to. */
  resolved?: string
  /** skills-lock v2 hash over the package files. */
  contentHash: string
  /** Per harness: the same hash over everything forge delivers to it for this plugin. */
  outputs: Record<string, string>
}

export interface PluginLock {
  version: typeof PLUGIN_LOCK_VERSION
  plugins: PluginLockEntry[]
  variants: Record<string, string>
}

export const LOCK_ACTIONS = {RESOLVE: 'resolve', LOCKED: 'locked', RELOCK: 'relock'} as const
export type LockAction = (typeof LOCK_ACTIONS)[keyof typeof LOCK_ACTIONS]

export function emptyPluginLock(): PluginLock {
  return {version: PLUGIN_LOCK_VERSION, plugins: [], variants: {}}
}

/** The descriptor the lock records; an explicit `branch` is the deprecated spelling of `ref`. */
export function lockedSource(source: PluginSourceConfig): LockedSource {
  if (source.type === 'local') return {type: 'local', path: source.path}
  return {
    type: 'git',
    url: source.url,
    ...(source.path === undefined ? {} : {path: source.path}),
    ref: source.ref ?? source.branch ?? DEFAULT_PLUGIN_REF,
  }
}

function sourceKey(source: LockedSource): string {
  return JSON.stringify(
    source.type === 'local' ? [source.type, source.path] : [source.type, source.url, source.path ?? null, source.ref],
  )
}

export function sourceWarnings(plugin: PluginConfig): string[] {
  return plugin.source.type === 'git' && plugin.source.branch !== undefined
    ? [`Plugin "${plugin.name}": "branch" is a deprecated alias for "ref" on plugin sources; write "ref" instead`]
    : []
}

/** Spec 0003 §4 lock discipline, before content is read. A `local` relock on changed content is decided later. */
export function decideLockAction(plugin: PluginConfig, entry?: PluginLockEntry): {action: LockAction; reason?: string} {
  if (!entry) return {action: LOCK_ACTIONS.RESOLVE}
  if (sourceKey(entry.source) !== sourceKey(lockedSource(plugin.source)))
    return {action: LOCK_ACTIONS.RELOCK, reason: 'source descriptor changed'}
  if (entry.source.type === 'git' && !entry.resolved)
    return {action: LOCK_ACTIONS.RELOCK, reason: 'lock entry has no resolved commit'}
  return {action: LOCK_ACTIONS.LOCKED}
}

/**
 * `variants[<harness>] = "sha256:" + hex(sha256(lines))`, one `<name>@<version> <outputHash>\n` line per plugin
 * delivered to that harness, sorted by name: config order, paths, scope and time never enter it.
 */
export function computeVariants(plugins: readonly PluginLockEntry[]): Record<string, string> {
  const lines: Record<string, string[]> = {}
  for (const plugin of [...plugins].sort((a, b) => compare(a.name, b.name)))
    for (const [harness, hash] of Object.entries(plugin.outputs))
      (lines[harness] ??= []).push(`${plugin.name}@${plugin.version} ${hash}\n`)
  return Object.fromEntries(
    Object.keys(lines)
      .sort(compare)
      .map((harness) => [harness, `sha256:${hashContent(lines[harness].join(''))}`]),
  )
}

/** Canonical lock: entries sorted by name with a fixed key order, so equal content serializes to equal bytes. */
export function buildPluginLock(plugins: readonly PluginLockEntry[]): PluginLock {
  const entries = [...plugins]
    .sort((a, b) => compare(a.name, b.name))
    .map((entry) => ({
      name: entry.name,
      version: entry.version,
      source: lockedSource(entry.source),
      ...(entry.resolved === undefined ? {} : {resolved: entry.resolved}),
      contentHash: entry.contentHash,
      outputs: Object.fromEntries(
        Object.keys(entry.outputs)
          .sort(compare)
          .map((h) => [h, entry.outputs[h]]),
      ),
    }))
  return {version: PLUGIN_LOCK_VERSION, plugins: entries, variants: computeVariants(entries)}
}
