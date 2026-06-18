import {SHARED_MESSAGES} from '../shared'

export const UNINSTALL_MESSAGES = {
  errors: {
    ...SHARED_MESSAGES.errors,
  },
  intro: 'Forge — Uninstall',
  confirm: 'This will remove the .crucible directory, synced files, and the scheduler. Continue?',
  schedulerRemoved: 'Scheduler uninstalled.',
  schedulerNotInstalled: 'Scheduler: not installed (skipped).',
  syncedFilesRemoved: (count: number) => `Removed ${count} synced file(s).`,
  syncedFilesNone: 'No synced files to remove.',
  configRemoved: 'Removed .crucible directory.',
  done: 'Forge has been uninstalled from this project.',
  cancelled: 'Uninstall cancelled.',
} as const
