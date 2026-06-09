import {describeCron, isValidCron, nextCronRun} from '@domain/scheduler'
import * as prompts from '@infrastructure/cli/prompts'
import * as renderer from '@infrastructure/cli/renderer'
import {loadProjectConfig, writeProjectConfig} from '@infrastructure/config'
import io from '@infrastructure/io'
import {createFileLogger, getLogDir, LOG_LEVELS} from '@infrastructure/logger'
import {getSchedulerBackend} from '@infrastructure/scheduler'

import {promptSchedule} from '../shared/scheduler.prompt'
import {SCHEDULER_MESSAGES as M} from './messages'

function resolveForgeCommand(): string {
  // Compiled binary: process.execPath IS the forge binary
  // Dev mode (bun run): process.execPath is bun, argv[1] is the script
  const execPath = process.execPath
  const base = execPath.endsWith('/bun') || execPath.endsWith('/bun.exe') ? `${execPath} ${process.argv[1]}` : execPath
  return `${base} sync --silent`
}

const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function formatDateTime(date: Date): string {
  const day = days[date.getDay()]
  const dd = String(date.getDate()).padStart(2, '0')
  const mon = months[date.getMonth()]
  const yyyy = date.getFullYear()
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `${day} ${dd} ${mon} ${yyyy}, ${hh}:${mm}`
}

export async function runSchedulerInstall(): Promise<void> {
  const logger = createFileLogger()
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
  renderer.renderDim(M.confirm.install(desc))

  const backend = getSchedulerBackend()

  try {
    await backend.install(projectRoot, schedule, resolveForgeCommand())
  } catch (err) {
    renderer.renderError(M.errors.installFailed(err instanceof Error ? err.message : String(err)))
    process.exit(1)
  }

  logger.info('scheduler installed', {schedule, cron: desc, projectRoot})
  renderer.renderSuccess(M.output.installed(desc))
  renderer.renderDim(M.output.logPath(getLogDir()))
}

export async function runSchedulerUninstall(): Promise<void> {
  const logger = createFileLogger()
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
    logger.error('scheduler uninstall failed', {error: err instanceof Error ? err.message : String(err)})
    renderer.renderError(M.errors.uninstallFailed(err instanceof Error ? err.message : String(err)))
    process.exit(1)
  }

  logger.info('scheduler uninstalled', {projectRoot})
  renderer.renderSuccess(M.output.uninstalled)
}

// ─── Interactive menu (forge scheduler with no subcommand) ───────────────────

const ACTION_INSTALL = 'install'
const ACTION_UNINSTALL = 'uninstall'
const ACTION_CHANGE = 'change'
const ACTION_DONE = 'done'

export async function runScheduler(): Promise<void> {
  const projectRoot = io.resolveProjectRoot()

  prompts.intro(M.intro)

  // Always show status first
  await showStatus(projectRoot)

  let editing = true
  while (editing) {
    const action = await prompts.select({
      message: M.selectAction,
      options: [
        {value: ACTION_INSTALL, label: M.actionInstall},
        {value: ACTION_UNINSTALL, label: M.actionUninstall},
        {value: ACTION_CHANGE, label: M.actionChangeSchedule},
        {value: ACTION_DONE, label: M.actionDone},
      ],
    })

    if (action === ACTION_DONE) break

    if (action === ACTION_INSTALL) await runSchedulerInstall()
    if (action === ACTION_UNINSTALL) await runSchedulerUninstall()
    if (action === ACTION_CHANGE) await changeSchedule(projectRoot)

    await showStatus(projectRoot)

    editing = await prompts.confirm({
      message: M.changeAnother,
      initialValue: false,
    })
  }

  prompts.outro(M.actionDone)
}

async function changeSchedule(projectRoot: string): Promise<void> {
  const config = await loadProjectConfig(projectRoot)
  if (!config) {
    renderer.renderError(M.errors.noConfig, M.errors.noConfigHint)
    return
  }

  const currentSchedule = config.sync?.schedule
  const schedule = await promptSchedule(currentSchedule)

  if (schedule) {
    const logger = createFileLogger()
    await writeProjectConfig(projectRoot, {
      ...config,
      sync: {...(config.sync ?? {}), schedule},
    })
    logger.info('schedule changed', {schedule})
    renderer.renderSuccess(M.configSaved)
  }
}

async function showStatus(projectRoot: string): Promise<void> {
  const context = await io.buildContext(projectRoot)
  const backend = getSchedulerBackend()
  const installed = await backend.isInstalled(projectRoot)

  renderer.renderNewline()

  if (!installed) {
    renderer.renderInfo(M.output.status.notInstalled)
  } else {
    renderer.renderSuccess(M.output.status.installed)
  }

  const schedule = context.projectConfig?.sync?.schedule
  if (schedule) {
    renderer.renderDim(M.output.status.schedule(describeCron(schedule)))

    if (installed) {
      const next = nextCronRun(schedule)
      if (next) {
        renderer.renderDim(M.output.status.nextRun(formatDateTime(next)))
      }
    }
  }

  renderer.renderNewline()
}

// ─── Subcommand handlers ─────────────────────────────────────────────────────

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

    const next = nextCronRun(schedule)
    if (next) {
      renderer.renderDim(M.output.status.nextRun(formatDateTime(next)))
    }
  }

  const logger = createFileLogger()
  const entries = await logger.readRecent(10)

  if (entries.length > 0) {
    const last = entries[entries.length - 1]
    const success = last.level !== LOG_LEVELS.ERROR
    renderer.renderDim(M.output.status.lastRun(last.ts.replace('T', ' ').slice(0, 16), success))
  } else {
    renderer.renderDim(M.output.status.noRuns)
  }

  renderer.renderDim(M.output.logPath(logger.getLogDir()))
}
