import {SHARED_MESSAGES} from '../shared'

export const SYNC_MESSAGES = {
  errors: {
    ...SHARED_MESSAGES.errors,
    noSource: 'No source configured',
    noSourceHint: 'Run `forge init` to configure a source',
    noSourceHintExisting: 'Run `forge config` to add a source',
    noAssistants: 'No assistants enabled',
    noAssistantsHint: 'Run `forge init` to configure assistants',
    applyFailed: (error: string) => `Failed: ${error}`,
    sourceFetchFailed: (name: string, error: string) => `Failed to fetch source "${name}": ${error}`,
    sourceConflict: (count: number) => `${count} file(s) have conflicting sources (strategy: error)`,
    localConflict: (count: number) => `${count} file(s) modified locally and remotely (strategy: error)`,
  },

  warnings: {
    noFilesInSource: (name: string) => `No files found in source: ${name}`,
    noTargetsFromSource: (name: string) => `No files matched any target mapping from: ${name}`,
    noFilesToSync: 'No files to sync from any source',
  },

  summary: {
    errors: (count: number) => `${count} file(s) had errors during planning`,
    deleted: (count: number) => `${count} file(s) removed (no longer in source)`,
    conflictsResolved: (count: number, strategy: string) => `${count} conflict(s) resolved (${strategy})`,
    skipped: (count: number) => `${count} file(s) skipped (local-wins)`,
  },

  progress: {
    syncingSource: (name: string) => `Syncing from source: ${name}`,
    pullingSource: (type: string, name: string) => `Pulling ${type} source (${name})...`,
    fetchingSource: 'Fetching source...',
    sourceReady: 'Source ready',
    rollingBack: 'Rolling back...',
    rollbackComplete: 'Rollback complete',
  },

  output: {
    wouldSync: (names: string) => `Would sync from: ${names}`,
    dryRunHint: 'Run without --dry-run to apply.',
    strategyBanner: (source: string, local: string) => `Merging (source strategy: ${source}, local strategy: ${local})`,
    done: (count: number, names: string) => `Done. ${count} file(s) synced from ${names}.`,
    lastSync: (iso: string) => `Last sync: ${iso.replace('T', ' ').slice(0, 16)}`,
  },
} as const
