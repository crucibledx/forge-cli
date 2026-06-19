import {formatTimeAgo} from '@domain/format'
import {describeCron} from '@domain/scheduler'
import {detectDrift} from '@domain/sync/drift'
import * as renderer from '@infrastructure/cli/renderer'
import {loadSyncState} from '@infrastructure/config'
import {readDiskContents} from '@infrastructure/fs'
import io from '@infrastructure/io'
import {countLogFiles, getLogDir} from '@infrastructure/logger'
import {createReportService} from '@infrastructure/report'
import {getSchedulerBackend} from '@infrastructure/scheduler'
import {getSourceLoader} from '@infrastructure/source'

import {CommandError} from '../types'
import {HEALTH_MESSAGES as M} from './messages'
import type {HealthCommandAction} from './types'

export const runHealth: HealthCommandAction = async () => {
  const projectRoot = io.resolveProjectRoot()
  const context = await io.buildContext(projectRoot)

  if (!context.projectConfig) {
    throw new CommandError(M.errors.noConfig, M.errors.noConfigHint)
  }

  const config = context.projectConfig
  const reports = createReportService()
  const latest = await reports.readLatest()

  renderer.renderNewline()
  renderer.renderHeader(M.header)

  // Last sync
  if (latest) {
    renderer.renderDim(M.lastSync(formatTimeAgo(latest.timestamp), latest.success))
  } else {
    renderer.renderDim(M.lastSyncNever)
  }

  // Sync frequency
  const schedule = config.sync?.schedule
  if (schedule) {
    const backend = getSchedulerBackend()
    const installed = await backend.isInstalled(projectRoot)
    renderer.renderDim(M.syncFrequency(describeCron(schedule), installed))
  } else {
    renderer.renderDim(M.syncFrequencyNone)
  }

  // Sync drift
  const syncState = await loadSyncState(projectRoot)
  if (syncState.lastSync) {
    const diskContents = await readDiskContents(projectRoot, syncState)
    const drift = detectDrift(syncState, diskContents)
    const driftedCount = drift.files.filter((f) => f.status !== 'in_sync').length
    renderer.renderDim(M.syncDrift(driftedCount))
  } else {
    renderer.renderDim(M.syncDrift(0))
  }

  // Sources
  const sourceCount = config.sources.length
  let reachable = 0
  for (const source of config.sources) {
    try {
      const loader = getSourceLoader(source.type)
      await loader.load(source)
      reachable++
    } catch {
      // source not reachable
    }
  }
  renderer.renderDim(M.sources(sourceCount, reachable))

  // Assistants
  const activeAssistants = config.assistants.filter((a) => a.enabled !== false).map((a) => a.id)
  renderer.renderDim(M.assistants(activeAssistants))

  // Logs
  const logDir = getLogDir()
  const logCount = countLogFiles()
  renderer.renderDim(M.logs(logDir, logCount))

  // Reports
  const reportDir = reports.getReportDir()
  const history = await reports.readHistory(10_000)
  renderer.renderDim(M.reports(reportDir, history.length))

  renderer.renderNewline()
}
