import {SHARED_MESSAGES} from '../shared'

export const SYNC_MESSAGES = {
  errors: {
    ...SHARED_MESSAGES.errors,
    noSource: 'No source configured',
    noSourceHint: 'Run `forge init` to configure a source',
    noSourceHintExisting: 'Run `forge config` to add a source',
    noHarnesses: 'No harnesses enabled',
    noHarnessesHint: 'Run `forge init` to configure harnesses',
    aliasUndoFailed:
      'Could not undo the `assistants:` → `harnesses:` key rename in .crucible/forge.config.yaml; the config is still valid.',
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
    notDelivered: (harness: string, glob: string) =>
      `${harness} has no location for ${glob.replace('**', '')} files; they are not delivered to ${harness}.`,
    lastSync: (iso: string) => `Last sync: ${iso.replace('T', ' ').slice(0, 16)}`,
  },
} as const
