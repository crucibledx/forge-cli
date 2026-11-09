import type {SyncState} from './state'
import {hashContent} from './state'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface LocalConflict {
  targetPath: string
  localHash: string
  storedHash: string
  remoteHash: string
}

// ─── Detection ───────────────────────────────────────────────────────────────

/**
 * Determines if a locally existing file has been modified since the last sync.
 *
 * A local conflict exists when ALL of:
 * 1. The file was previously synced (exists in sync state)
 * 2. The local content hash differs from the stored hash (user edited it)
 * 3. The remote content hash differs from the stored hash (source changed too)
 *
 * If the file is new (not in sync state) or unchanged locally, there's no conflict.
 */
export function detectLocalConflict(
  targetPath: string,
  localContent: string | Uint8Array,
  remoteContent: string,
  syncState: SyncState,
): LocalConflict | null {
  const entry = syncState.files[targetPath]
  if (!entry) return null
  const localHash = hashContent(localContent)
  const remoteHash = hashContent(remoteContent)
  if (localHash === remoteHash) return null
  if (entry.baseline !== 'installed') {
    return {targetPath, localHash, storedHash: entry.hash, remoteHash}
  }

  if (localHash === entry.hash) return null
  if (remoteHash === entry.hash) return null

  return {targetPath, localHash, storedHash: entry.hash, remoteHash}
}
