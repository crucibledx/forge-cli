import {existsSync, mkdirSync, readdirSync, unlinkSync} from 'node:fs'
import {readFile, writeFile} from 'node:fs/promises'
import {homedir} from 'node:os'
import {join} from 'node:path'

import type {SyncReport} from '@domain/sync/report'

import type {ReportService} from './types'

const REPORT_DIR = join(homedir(), '.crucible', 'forge', 'reports')
const LATEST_FILE = 'latest.json'
const DEFAULT_MAX_AGE_DAYS = 30

function historyFilename(timestamp: string): string {
  return timestamp.replace(/[:.]/g, '-').replace('T', '-').replace('Z', '') + '.json'
}

export function createReportService(reportDir?: string): ReportService {
  const REPORT_DIR_RESOLVED = reportDir ?? REPORT_DIR
  const HISTORY_DIR_RESOLVED = join(REPORT_DIR_RESOLVED, 'history')

  return {
    async writeReport(report: SyncReport): Promise<void> {
      if (!existsSync(HISTORY_DIR_RESOLVED)) mkdirSync(HISTORY_DIR_RESOLVED, {recursive: true})
      const latestPath = join(REPORT_DIR_RESOLVED, LATEST_FILE)
      const historyPath = join(HISTORY_DIR_RESOLVED, historyFilename(report.timestamp))
      const json = JSON.stringify(report, null, 2)
      await Promise.all([writeFile(latestPath, json, 'utf-8'), writeFile(historyPath, json, 'utf-8')])
    },

    async readLatest(): Promise<SyncReport | null> {
      const latestPath = join(REPORT_DIR_RESOLVED, LATEST_FILE)
      if (!existsSync(latestPath)) return null
      try {
        const content = await readFile(latestPath, 'utf-8')
        return JSON.parse(content) as SyncReport
      } catch {
        return null
      }
    },

    async readHistory(limit = 50): Promise<SyncReport[]> {
      if (!existsSync(HISTORY_DIR_RESOLVED)) return []
      const files = readdirSync(HISTORY_DIR_RESOLVED)
        .filter((f) => f.endsWith('.json'))
        .sort()
        .slice(-limit)

      const reports: SyncReport[] = []
      for (const file of files) {
        try {
          const content = await readFile(join(HISTORY_DIR_RESOLVED, file), 'utf-8')
          reports.push(JSON.parse(content) as SyncReport)
        } catch {
          // skip corrupt files
        }
      }
      return reports
    },

    async rotate(maxAgeDays = DEFAULT_MAX_AGE_DAYS): Promise<void> {
      if (!existsSync(HISTORY_DIR_RESOLVED)) return

      const cutoff = new Date()
      cutoff.setDate(cutoff.getDate() - maxAgeDays)
      const cutoffStr = cutoff.toISOString().replace(/[:.]/g, '-').replace('T', '-').replace('Z', '')

      const files = readdirSync(HISTORY_DIR_RESOLVED).filter((f) => f.endsWith('.json'))
      for (const file of files) {
        const name = file.replace('.json', '')
        if (name < cutoffStr) {
          unlinkSync(join(HISTORY_DIR_RESOLVED, file))
        }
      }
    },

    getReportDir: () => REPORT_DIR_RESOLVED,
  }
}
