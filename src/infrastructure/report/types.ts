import type {SyncReport} from '@domain/sync/report'

export interface ReportService {
  writeReport: (report: SyncReport) => Promise<void>
  readLatest: () => Promise<SyncReport | null>
  readHistory: (limit?: number) => Promise<SyncReport[]>
  rotate: (maxAgeDays?: number) => Promise<void>
  getReportDir: () => string
}
