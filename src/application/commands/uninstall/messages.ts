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
  ownedKeysRemoved: (count: number) => `Removed forge-owned keys from ${count} settings file(s).`,
  ownedKeyKept: (key: string) => `Kept ${key}: it was changed outside forge.`,
  configRemoved: 'Removed .crucible directory.',
  done: 'Forge has been uninstalled from this project.',
  cancelled: 'Uninstall cancelled.',
} as const
