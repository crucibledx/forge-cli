import {createHash} from 'node:crypto'

// ─── Types ──────────────────────────────────────────────────────────────────
export const SYNC_BASELINES = {INSTALLED: 'installed', LEGACY_UNKNOWN: 'legacy-unknown'} as const
export type SyncBaseline = (typeof SYNC_BASELINES)[keyof typeof SYNC_BASELINES]

export interface SyncStateEntry {
  hash: string
  sourceName: string
  baseline?: SyncBaseline
  /** State v3: key path → sha256 of the value forge merged. Present only when forge owns keys, not the whole file. */
  ownedKeys?: Record<string, string>
}

export const SYNC_STATE_VERSION = 3

export interface SyncState {
  version?: 2 | typeof SYNC_STATE_VERSION
  lastSync: string
  files: Record<string, SyncStateEntry>
}

// ─── Helpers ────────────────────────────────────────────────────────────────

export function hashContent(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex')
}

export function emptySyncState(): SyncState {
  return {version: SYNC_STATE_VERSION, lastSync: '', files: {}}
}

/** A keyed entry: forge owns some keys of a shared settings file, never the file itself. */
export function isKeyedEntry(entry: SyncStateEntry): boolean {
  return Object.keys(entry.ownedKeys ?? {}).length > 0
}

export function keyedStateEntry(sourceName: string, ownedKeys: Record<string, string>): SyncStateEntry | null {
  const keys = Object.keys(ownedKeys).sort()
  if (!keys.length) return null
  return {
    hash: hashContent(JSON.stringify(keys.map((key) => [key, ownedKeys[key]]))),
    sourceName,
    baseline: SYNC_BASELINES.INSTALLED,
    ownedKeys: Object.fromEntries(keys.map((key) => [key, ownedKeys[key]])),
  }
}

/** Replaces or drops keyed entries after a keyed-merge plan; null removes the entry. */
export function withKeyedEntries(state: SyncState, entries: Record<string, SyncStateEntry | null>): SyncState {
  const files = {...state.files}
  for (const [path, entry] of Object.entries(entries)) {
    if (entry) files[path] = entry
    else delete files[path]
  }
  return {...state, files}
}
