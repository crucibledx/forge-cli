import {createHash} from 'node:crypto'

// ─── Types ──────────────────────────────────────────────────────────────────
export const SYNC_BASELINES = {INSTALLED: 'installed', LEGACY_UNKNOWN: 'legacy-unknown'} as const
export type SyncBaseline = (typeof SYNC_BASELINES)[keyof typeof SYNC_BASELINES]

export interface SyncStateEntry {
  hash: string
  sourceName: string
  baseline?: SyncBaseline
}

export interface SyncState {
  version?: 2
  lastSync: string
  files: Record<string, SyncStateEntry>
}

// ─── Helpers ────────────────────────────────────────────────────────────────

export function hashContent(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex')
}

interface FileState {
  targetPath: string
  content: string
  sourceName: string
}

export function buildSyncState(files: Array<FileState>): SyncState {
  const entries: Record<string, SyncStateEntry> = {}
  for (const file of files) {
    entries[file.targetPath] = {
      hash: hashContent(file.content),
      sourceName: file.sourceName,
      baseline: 'installed',
    }
  }
  return {
    version: 2,
    lastSync: new Date().toISOString(),
    files: entries,
  }
}

export function emptySyncState(): SyncState {
  return {version: 2, lastSync: '', files: {}}
}
