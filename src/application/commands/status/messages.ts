import {SHARED_MESSAGES} from '../shared'

export const STATUS_MESSAGES = {
  errors: {
    ...SHARED_MESSAGES.errors,
    neverSynced: 'No sync state found — run `forge sync` first.',
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
