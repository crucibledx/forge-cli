import type {ProjectConfig} from '@domain/config/types'
import {redact, redactData} from '@domain/redact'
import {buildSyncReport} from '@domain/sync/report'
import type {SyncFileSummary} from '@domain/sync/types'
import {SYNC_FILE_STATUSES as S} from '@domain/sync/types'
import * as renderer from '@infrastructure/cli/renderer'
import type {ReportService} from '@infrastructure/report'
import {createReportService} from '@infrastructure/report'

import {SafetyError} from './errors'

interface SyncOutcome {
  dryRun: boolean
  started: number
  config?: ProjectConfig
  reports?: ReportService
  success: boolean
  summaries: SyncFileSummary[]
  error?: unknown
}
/** Reporting is incidental: never reverse a committed result or write during preview. */
export async function persistOutcome({dryRun, started, config, reports, success, summaries, error}: SyncOutcome) {
  if (dryRun) return
  const service = reports ?? createReportService()
  const message = error instanceof Error ? error.message : error === undefined ? undefined : String(error)
  const count = (...statuses: string[]) => summaries.filter((summary) => statuses.includes(summary.status)).length
  const report = buildSyncReport({
    startTime: started,
    sources: config?.sources.map((source) => source.name) ?? [],
    assistants: config?.assistants.filter((assistant) => assistant.enabled).map((assistant) => assistant.id) ?? [],
    synced: success ? count(S.NEW, S.UPDATE, S.DELETED) : 0,
    skipped: success ? count(S.NO_CHANGE) : 0,
    conflicts: success ? count(S.SKIPPED) : 0,
    errors: success ? 0 : error instanceof SafetyError ? Math.max(1, error.errorCount) : 1,
    driftDetails: [],
    success,
    error: message === undefined ? undefined : redact(message),
  })
  try {
    await service.writeReport(redactData(report))
    await service.rotate()
  } catch {
    renderer.renderWarning(
      'Report storage unavailable; the sync outcome is unchanged. Preserve the primary diagnostic.',
    )
  }
}
