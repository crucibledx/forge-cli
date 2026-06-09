import {SHARED_MESSAGES} from '../shared'

export const HEALTH_MESSAGES = {
  errors: {
    ...SHARED_MESSAGES.errors,
  },
  header: 'Forge Health Report',
  lastSync: (timeAgo: string, success: boolean) => `Last sync:        ${timeAgo} (${success ? 'success' : 'failed'})`,
  lastSyncNever: 'Last sync:        never',
  syncFrequency: (desc: string, installed: boolean) =>
    `Sync frequency:   ${desc} (scheduler ${installed ? 'active' : 'not installed'})`,
  syncFrequencyNone: 'Sync frequency:   manual (no schedule)',
  configDrift: (count: number) =>
    `Config drift:     ${count === 0 ? 'none detected' : `${count} file(s) drifted since last sync`}`,
  sources: (configured: number, reachable: number) =>
    `Sources:          ${configured} configured, ${reachable} reachable`,
  assistants: (ids: string[]) => `Assistants:       ${ids.length} active (${ids.join(', ')})`,
  logs: (dir: string, count: number) => `Logs:             ${dir} (${count} file(s))`,
  reports: (dir: string, count: number) => `Reports:          ${dir} (${count} entries)`,
  noReport: 'No sync reports found. Run `forge sync` first.',
} as const
