import type {SyncState} from './state'
import {hashContent} from './state'

// ─── Types ───────────────────────────────────────────────────────────────────

export const DRIFT_STATUSES = {
  IN_SYNC: 'in_sync',
  MODIFIED: 'modified',
  DELETED: 'deleted',
  REMOTE_UPDATED: 'remote_updated',
  CONFLICT: 'conflict',
  NEW_IN_SOURCE: 'new_in_source',
  REMOVED_FROM_SOURCE: 'removed_from_source',
} as const

export type DriftStatus = (typeof DRIFT_STATUSES)[keyof typeof DRIFT_STATUSES]

export interface DriftEntry {
  targetPath: string
  sourceName: string
  status: DriftStatus
}

export interface DriftSummary {
  lastSync: string
  files: DriftEntry[]
}

// ─── Detection ───────────────────────────────────────────────────────────────

/**
 * Compares disk content against sync state to detect local drift.
 *
 * For each file in sync state, the caller provides the current disk content
 * (or `null` if the file no longer exists). Returns a summary of all files
 * with their drift status.
 */
export function detectDrift(syncState: SyncState, diskContents: Record<string, string | null>): DriftSummary {
  const files: DriftEntry[] = []

  for (const [targetPath, entry] of Object.entries(syncState.files)) {
    const diskContent = diskContents[targetPath]

    if (diskContent === null || diskContent === undefined) {
      files.push({targetPath, sourceName: entry.sourceName, status: DRIFT_STATUSES.DELETED})
      continue
    }

    const diskHash = hashContent(diskContent)
    const status = diskHash === entry.hash ? DRIFT_STATUSES.IN_SYNC : DRIFT_STATUSES.MODIFIED

    files.push({targetPath, sourceName: entry.sourceName, status})
  }

  return {lastSync: syncState.lastSync, files}
}

/**
 * Full drift detection: compares sync state, disk contents, AND remote resolved targets.
 * Returns rich statuses including remote-side changes.
 */
export function detectFullDrift(
  syncState: SyncState,
  diskContents: Record<string, string | null>,
  remoteContents: Record<string, string>,
): DriftSummary {
  const files: DriftEntry[] = []
  const allPaths = new Set([...Object.keys(syncState.files), ...Object.keys(remoteContents)])

  for (const targetPath of allPaths) {
    const stored = syncState.files[targetPath]
    const disk = diskContents[targetPath]
    const remote = remoteContents[targetPath]

    // New file in source, not previously synced
    if (!stored && remote !== undefined) {
      files.push({targetPath, sourceName: '', status: DRIFT_STATUSES.NEW_IN_SOURCE})
      continue
    }

    // Was synced but no longer in source
    if (stored && remote === undefined) {
      files.push({targetPath, sourceName: stored.sourceName, status: DRIFT_STATUSES.REMOVED_FROM_SOURCE})
      continue
    }

    if (!stored) continue

    const diskHash = disk !== null && disk !== undefined ? hashContent(disk) : null
    const remoteHash = remote !== undefined ? hashContent(remote) : null
    const localChanged = diskHash !== null && diskHash !== stored.hash
    const remoteChanged = remoteHash !== null && remoteHash !== stored.hash

    if (disk === null || disk === undefined) {
      files.push({targetPath, sourceName: stored.sourceName, status: DRIFT_STATUSES.DELETED})
    } else if (localChanged && remoteChanged) {
      files.push({targetPath, sourceName: stored.sourceName, status: DRIFT_STATUSES.CONFLICT})
    } else if (remoteChanged) {
      files.push({targetPath, sourceName: stored.sourceName, status: DRIFT_STATUSES.REMOTE_UPDATED})
    } else if (localChanged) {
      files.push({targetPath, sourceName: stored.sourceName, status: DRIFT_STATUSES.MODIFIED})
    } else {
      files.push({targetPath, sourceName: stored.sourceName, status: DRIFT_STATUSES.IN_SYNC})
    }
  }

  return {lastSync: syncState.lastSync, files}
}
