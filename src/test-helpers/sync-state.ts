import type {SyncState, SyncStateEntry} from '@domain/sync/state'
import {hashContent, SYNC_BASELINES} from '@domain/sync/state'

/** Test fixture convenience only. Production preserves retained entries through reconcileState. */
export function buildSyncState(files: {targetPath: string; content: string; sourceName: string}[]): SyncState {
  const entries: Record<string, SyncStateEntry> = {}
  for (const file of files)
    entries[file.targetPath] = {
      hash: hashContent(file.content),
      sourceName: file.sourceName,
      baseline: SYNC_BASELINES.INSTALLED,
    }
  return {version: 2, lastSync: new Date().toISOString(), files: entries}
}
