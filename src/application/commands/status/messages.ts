import {SHARED_MESSAGES} from '../shared'

export const STATUS_MESSAGES = {
  errors: {
    ...SHARED_MESSAGES.errors,
    neverSynced: 'No sync state found — run `forge sync` first.',
  },
  context: {
    assistants: (ids: string[]) => `Assistants: ${ids.join(', ')}`,
    sources: (names: string[]) => `Sources: ${names.join(', ')}`,
    noSources: 'Sources: none configured',
    schedule: (desc: string) => `Schedule: ${desc}`,
    noSchedule: 'Schedule: not configured',
    schedulerInstalled: 'Scheduler: installed',
    schedulerNotInstalled: 'Scheduler: not installed',
    hintSchedulerActive: (nextRun: string) =>
      `Next auto-sync: ${nextRun}. Run \`forge sync\` if you don't want to wait.`,
    hintScheduleNotInstalled:
      'Schedule is configured but scheduler is not installed. Run `forge scheduler install` or `forge sync` manually.',
    hintNoSchedule: 'Run `forge sync` to sync, or `forge scheduler` to set up auto-sync.',
    hintNoSources: 'Add a source with `forge config` first, then run `forge sync`.',
  },
  output: {
    configFound: (path: string) => `Config: ${path}`,
    lastSync: (timeAgo: string) => `Last sync: ${timeAgo}`,
    allInSync: 'All files in sync ✓',
    hint: 'Run `forge sync` to apply remote changes.',
  },
  summary: {
    modified: (count: number) => `${count} file(s) modified locally`,
    deleted: (count: number) => `${count} file(s) deleted locally`,
    remoteUpdated: (count: number) => `${count} file(s) updated remotely — will overwrite on sync`,
    conflict: (count: number) => `${count} file(s) modified locally AND remotely — conflict`,
    newInSource: (count: number) => `${count} new file(s) in source — will be added on sync`,
    removedFromSource: (count: number) => `${count} file(s) removed from source`,
  },
}
