import type {TelemetryEvent} from '../types'

export const TELEMETRY_BACKEND_TYPES = {
  LOCAL: 'local',
} as const

export type TelemetryBackendType = (typeof TELEMETRY_BACKEND_TYPES)[keyof typeof TELEMETRY_BACKEND_TYPES]

export interface TelemetryBackend {
  write(event: TelemetryEvent): Promise<void>
  readAll(limit?: number): Promise<TelemetryEvent[]>
  count(): Promise<number>
  clear(): Promise<void>
  storageDir: string
}

export interface TelemetryBackendEntry {
  alias: TelemetryBackendType
  label: string
  create: () => TelemetryBackend
}
