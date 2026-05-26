import type {SyncState} from './state'
import {hashContent} from './state'

// ─── Types ───────────────────────────────────────────────────────────────────

export const DRIFT_STATUSES = {
  IN_SYNC: 'in_sync',
  MODIFIED: 'modified',
  DELETED: 'deleted',
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
