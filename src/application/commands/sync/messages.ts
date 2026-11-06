import {SHARED_MESSAGES} from '../shared'

export const SYNC_MESSAGES = {
  errors: {
    ...SHARED_MESSAGES.errors,
    noSource: 'No source configured',
    noSourceHint: 'Run `forge init` to configure a source',
    noSourceHintExisting: 'Run `forge config` to add a source',
    noAssistants: 'No assistants enabled',
    noAssistantsHint: 'Run `forge init` to configure assistants',
    sourceFetchFailed: (name: string, error: string) => `Failed to fetch source "${name}": ${error}`,
  },

  progress: {
    syncingSource: (name: string) => `Syncing from source: ${name}`,
  },

  output: {
    wouldSync: (names: string) => `Would sync from: ${names}`,
    dryRunHint: 'Run without --dry-run to apply.',
    strategyBanner: (source: string, local: string) => `Merging (source strategy: ${source}, local strategy: ${local})`,
    done: (count: number, names: string) => `Done. ${count} file(s) synced from ${names}.`,
    lastSync: (iso: string) => `Last sync: ${iso.replace('T', ' ').slice(0, 16)}`,
  },
} as const
