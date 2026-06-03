import {SHARED_MESSAGES} from '../shared'

export const SCHEDULER_MESSAGES = {
  errors: {
    ...SHARED_MESSAGES.errors,
    noSchedule: 'No schedule configured',
    noScheduleHint: 'Add `sync.schedule` to your config (e.g. "0 9 * * 1").',
    invalidCron: (expr: string) => `Invalid cron expression: "${expr}"`,
    installFailed: (err: string) => `Failed to install scheduler: ${err}`,
    uninstallFailed: (err: string) => `Failed to uninstall scheduler: ${err}`,
  },
  confirm: {
    install: (desc: string) =>
      `This will register a scheduled task with your OS.\n    forge sync will run automatically: ${desc}`,
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
