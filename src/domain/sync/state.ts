import {createHash} from 'node:crypto'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SyncStateEntry {
  hash: string
  sourceName: string
  baseline?: 'installed' | 'legacy-unknown'
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
