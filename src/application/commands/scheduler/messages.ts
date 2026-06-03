import {SHARED_MESSAGES} from '../shared'

export const SCHEDULER_MESSAGES = {
  intro: 'Forge — Scheduler',
  selectAction: 'What would you like to do?',
  actionInstall: 'Install scheduler',
  actionUninstall: 'Uninstall scheduler',
  actionChangeSchedule: 'Change schedule',
  actionDone: 'Done',
  changeAnother: 'Anything else?',
  configSaved: 'Schedule updated in config.',
  errors: {
    ...SHARED_MESSAGES.errors,
    noSchedule: 'No schedule configured',
    noScheduleHint: 'Add `sync.schedule` to your config (e.g. "0 9 * * 1").',
    invalidCron: (expr: string) => `Invalid cron expression: "${expr}"`,
    installFailed: (err: string) => `Failed to install scheduler: ${err}`,
    uninstallFailed: (err: string) => `Failed to uninstall scheduler: ${err}`,
  },
  confirm: {
    install: (desc: string) => `Registering scheduled task: ${desc}`,
    uninstall: 'Remove the scheduled sync task?',
  },
  output: {
    installed: (desc: string) => `Scheduler installed. Schedule: ${desc}`,
    uninstalled: 'Scheduled task removed.',
    notInstalled: 'No scheduler is installed for this project.',
    logPath: (path: string) => `Logs: ${path}`,
    status: {
      header: 'Scheduler Status',
      installed: 'Scheduler: installed',
      notInstalled: 'Scheduler: not installed',
      schedule: (desc: string) => `Schedule: ${desc}`,
      lastRun: (time: string, success: boolean) => `Last run: ${time}  ${success ? '✓ (no errors)' : '✗ (had errors)'}`,
      noRuns: 'Last run: never',
    },
  },
}
