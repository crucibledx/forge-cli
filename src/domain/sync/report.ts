import type {DriftEntry} from './drift'
import {DRIFT_STATUSES} from './drift'

export interface SyncReportFiles {
  synced: number
  skipped: number
  conflicts: number
  errors: number
}

export interface SyncReportDrift {
  detected: boolean
  files_drifted: number
  details: DriftEntry[]
}

export interface SyncReport {
  timestamp: string
  duration_ms: number
  sources: string[]
  assistants: string[]
  files: SyncReportFiles
  drift: SyncReportDrift
  success: boolean
  error?: string
}

export function buildSyncReport(opts: {
  startTime: number
  sources: string[]
  assistants: string[]
  synced: number
  skipped: number
  conflicts: number
  errors: number
  driftDetails: DriftEntry[]
  success: boolean
  error?: string
}): SyncReport {
  const drifted = opts.driftDetails.filter((d) => d.status !== DRIFT_STATUSES.IN_SYNC)
  return {
    timestamp: new Date().toISOString(),
    duration_ms: Date.now() - opts.startTime,
    sources: opts.sources,
    assistants: opts.assistants,
    files: {
      synced: opts.synced,
      skipped: opts.skipped,
      conflicts: opts.conflicts,
      errors: opts.errors,
    },
    drift: {
      detected: drifted.length > 0,
      files_drifted: drifted.length,
      details: opts.driftDetails,
    },
    success: opts.success,
    error: opts.error,
  }
}
