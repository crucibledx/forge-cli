import {resolve} from 'node:path'

import {describeCron, isValidCron} from '@domain/scheduler'
import * as renderer from '@infrastructure/cli/renderer'
import io from '@infrastructure/io'
import {createSchedulerLogger, getLogPath, LOG_LEVELS} from '@infrastructure/logger'
import {getSchedulerBackend} from '@infrastructure/scheduler'

import {SCHEDULER_MESSAGES as M} from './messages'

const WORKER_PATH = resolve(import.meta.dir, 'worker.ts')

export async function runSchedulerInstall(): Promise<void> {
  const projectRoot = io.resolveProjectRoot()
  const context = await io.buildContext(projectRoot)

  if (!context.projectConfig) {
    renderer.renderError(M.errors.noConfig, M.errors.noConfigHint)
    process.exit(1)
  }

  const schedule = context.projectConfig.sync?.schedule
  if (!schedule) {
    renderer.renderError(M.errors.noSchedule, M.errors.noScheduleHint)
    process.exit(1)
  }

  if (!isValidCron(schedule)) {
    renderer.renderError(M.errors.invalidCron(schedule))
    process.exit(1)
  }

  const desc = describeCron(schedule)
  renderer.renderWarning(M.confirm.install(desc))

  const backend = getSchedulerBackend()

  try {
    await backend.install(projectRoot, schedule, WORKER_PATH)
  } catch (err) {
    renderer.renderError(M.errors.installFailed(err instanceof Error ? err.message : String(err)))
    process.exit(1)
  }

  renderer.renderSuccess(M.output.installed(desc))
  renderer.renderDim(M.output.logPath(getLogPath()))
}

export async function runSchedulerUninstall(): Promise<void> {
  const projectRoot = io.resolveProjectRoot()

  const backend = getSchedulerBackend()
  const installed = await backend.isInstalled(projectRoot)

  if (!installed) {
    renderer.renderInfo(M.output.notInstalled)
    return
  }

  try {
    await backend.uninstall(projectRoot)
  } catch (err) {
    renderer.renderError(M.errors.uninstallFailed(err instanceof Error ? err.message : String(err)))
    process.exit(1)
  }

  renderer.renderSuccess(M.output.uninstalled)
}

export async function runSchedulerStatus(): Promise<void> {
  const projectRoot = io.resolveProjectRoot()
  const context = await io.buildContext(projectRoot)

  if (!context.projectConfig) {
    renderer.renderError(M.errors.noConfig, M.errors.noConfigHint)
    process.exit(1)
  }

  const backend = getSchedulerBackend()
  const installed = await backend.isInstalled(projectRoot)

  renderer.renderNewline()

  if (!installed) {
    renderer.renderInfo(M.output.status.notInstalled)
    return
  }

  renderer.renderSuccess(M.output.status.installed)

  const schedule = context.projectConfig.sync?.schedule
  if (schedule) {
    renderer.renderDim(M.output.status.schedule(describeCron(schedule)))
  }

  const logger = createSchedulerLogger()
  const entries = await logger.readRecent(10)

  if (entries.length > 0) {
    const last = entries[entries.length - 1]
    const success = last.level !== LOG_LEVELS.ERROR
    renderer.renderDim(M.output.status.lastRun(last.timestamp.replace('T', ' ').slice(0, 16), success))
  } else {
    renderer.renderDim(M.output.status.noRuns)
  }

  renderer.renderDim(M.output.logPath(logger.getLogPath()))
}
