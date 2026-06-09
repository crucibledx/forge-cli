import {existsSync, mkdirSync, readdirSync, unlinkSync} from 'node:fs'
import {readFile, writeFile} from 'node:fs/promises'
import {homedir} from 'node:os'
import {join} from 'node:path'

import type {SyncReport} from '@domain/sync/report'

import type {ReportService} from './types'

const REPORT_DIR = join(homedir(), '.crucible', 'forge', 'reports')
const HISTORY_DIR = join(REPORT_DIR, 'history')
const LATEST_FILE = 'latest.json'
const DEFAULT_MAX_AGE_DAYS = 30

function ensureDirs(): void {
  if (!existsSync(HISTORY_DIR)) {
    mkdirSync(HISTORY_DIR, {recursive: true})
  }
}

function historyFilename(timestamp: string): string {
  return timestamp.replace(/[:.]/g, '-').replace('T', '-').replace('Z', '') + '.json'
}

export function createReportService(): ReportService {
  return {
    async writeReport(report: SyncReport): Promise<void> {
      ensureDirs()
      const latestPath = join(REPORT_DIR, LATEST_FILE)
      const historyPath = join(HISTORY_DIR, historyFilename(report.timestamp))
      const json = JSON.stringify(report, null, 2)
      await Promise.all([writeFile(latestPath, json, 'utf-8'), writeFile(historyPath, json, 'utf-8')])
    },

    async readLatest(): Promise<SyncReport | null> {
      const latestPath = join(REPORT_DIR, LATEST_FILE)
      if (!existsSync(latestPath)) return null
      try {
        const content = await readFile(latestPath, 'utf-8')
        return JSON.parse(content) as SyncReport
      } catch {
        return null
      }
    },

    async readHistory(limit = 50): Promise<SyncReport[]> {
      if (!existsSync(HISTORY_DIR)) return []
      const files = readdirSync(HISTORY_DIR)
        .filter((f) => f.endsWith('.json'))
        .sort()
        .slice(-limit)

      const reports: SyncReport[] = []
      for (const file of files) {
        try {
          const content = await readFile(join(HISTORY_DIR, file), 'utf-8')
          reports.push(JSON.parse(content) as SyncReport)
        } catch {
          // skip corrupt files
        }
      }
      return reports
    },

    async rotate(maxAgeDays = DEFAULT_MAX_AGE_DAYS): Promise<void> {
      if (!existsSync(HISTORY_DIR)) return

      const cutoff = new Date()
      cutoff.setDate(cutoff.getDate() - maxAgeDays)
      const cutoffStr = cutoff.toISOString().replace(/[:.]/g, '-').replace('T', '-').replace('Z', '')

      const files = readdirSync(HISTORY_DIR).filter((f) => f.endsWith('.json'))
      for (const file of files) {
        const name = file.replace('.json', '')
        if (name < cutoffStr) {
          unlinkSync(join(HISTORY_DIR, file))
        }
      }
    },

    getReportDir: () => REPORT_DIR,
  }
}
