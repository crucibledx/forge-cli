// ─── Event Types ────────────────────────────────────────────────────────────

export const TELEMETRY_EVENTS = {
  SYNC: 'sync',
  INIT: 'init',
  CONFIG: 'config',
  STATUS: 'status',
  HEALTH: 'health',
  SCHEDULER_INSTALL: 'scheduler_install',
  SCHEDULER_UNINSTALL: 'scheduler_uninstall',
} as const

export type TelemetryEventName = (typeof TELEMETRY_EVENTS)[keyof typeof TELEMETRY_EVENTS]

export interface TelemetryEvent {
  ts: string
  event: TelemetryEventName
  forge_version: string
  os: string
  duration_ms: number
  success: boolean
  file_count?: number
}

// ─── Service Interface ──────────────────────────────────────────────────────

export interface TelemetryService {
  track(event: Omit<TelemetryEvent, 'ts' | 'forge_version' | 'os'>): Promise<void>
  readEvents(limit?: number): Promise<TelemetryEvent[]>
  eventCount(): Promise<number>
  clear(): Promise<void>
  getStorageDir(): string
}
