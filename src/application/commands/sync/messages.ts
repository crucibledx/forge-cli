export const SYNC_MESSAGES = {
  errors: {
    noConfig: 'No configuration file found',
    noConfigHint: 'Run `forge init` to create .crucible/forge.config.yaml',
    noSource: 'No source configured',
    noSourceHint: 'Run `forge init` to configure a source',
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
    done: (count: number, names: string) => `Done. ${count} files synced from ${names}.`,
    lastSync: (iso: string) => `Last sync: ${iso.replace('T', ' ').slice(0, 16)}`,
  },
} as const
