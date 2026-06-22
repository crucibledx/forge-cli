export const TELEMETRY_MESSAGES = {
  status: {
    header: 'Telemetry Status',
    enabled: 'Telemetry is enabled',
    disabled: 'Telemetry is disabled',
    globalEnabled: 'Global config: enabled',
    globalDisabled: 'Global config: disabled (or not set)',
    projectEnabled: 'Project config: enabled',
    projectDisabled: 'Project config: disabled',
    projectNotSet: 'Project config: inherits from global',
    noEvents: 'No telemetry events recorded yet.',
    eventCount: (count: number) => `${count} event${count === 1 ? '' : 's'} recorded`,
    storageDir: (dir: string) => `Storage: ${dir}`,
  },
  collected: {
    header: 'What Forge collects locally (when enabled):',
    items: [
      'Command name (sync, init, config, status, health)',
      'Forge version and OS platform',
      'Command duration in milliseconds',
      'Whether the command succeeded or failed',
      'Number of files synced (sync command only)',
    ],
    localOnly: 'All data is stored locally on your machine. Nothing is sent anywhere.',
    notCollected: 'NOT collected: file contents, paths, repo names, user identity.',
  },
  howTo: {
    toggle: 'Run: forge config edit --global → select Telemetry',
    projectOverride: 'Per-project override: forge config edit → select Telemetry',
  },
  reset: {
    cleared: (count: number) => `Cleared ${count} telemetry event${count === 1 ? '' : 's'}.`,
    nothingToClear: 'No telemetry events to clear.',
  },
}
