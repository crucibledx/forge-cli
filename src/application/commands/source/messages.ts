import {SHARED_MESSAGES} from '../shared'

export const SOURCE_COMMAND_MESSAGES = {
  errors: {
    ...SHARED_MESSAGES.errors,
    noSources: 'No sources configured.',
    noSourcesHint: 'Run `forge source add` or `forge init` to add one.',
    sourceNotFound: (name: string) => `Source "${name}" not found.`,
  },
  list: {
    header: 'Configured Sources',
    entry: (name: string, type: string, detail: string) => `${name}  (${type})  ${detail}`,
    syncedFiles: (count: number) => `${count} synced file(s)`,
    noSyncState: 'not synced yet',
  },
  add: {
    success: (name: string) => `Source "${name}" added.`,
  },
  edit: {
    which: 'Which source to edit?',
    success: (name: string) => `Source "${name}" updated.`,
  },
  remove: {
    which: 'Which source to remove?',
    confirm: (name: string) => `Remove source "${name}"?`,
    cleanFiles: (count: number) => `Clean ${count} synced file(s) from this source?`,
    removed: (name: string) => `Source "${name}" removed.`,
    cleaned: (count: number) => `Cleaned ${count} file(s).`,
    cleanFailed: (count: number, errors: number) => `Cleaned ${count} file(s), ${errors} failed.`,
    nothingToClean: 'No synced files to clean.',
  },
} as const
