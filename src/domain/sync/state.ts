import {createHash} from 'node:crypto'

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SyncStateEntry {
  hash: string
  sourceName: string
}

export interface SyncState {
  lastSync: string
  files: Record<string, SyncStateEntry>
}

// ─── Helpers ────────────────────────────────────────────────────────────────

export function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex')
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
    }
  }
  return {
    lastSync: new Date().toISOString(),
    files: entries,
  }
}

export function emptySyncState(): SyncState {
  return {lastSync: '', files: {}}
}
