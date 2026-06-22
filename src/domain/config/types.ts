import type {AssistantConfig} from '@domain/assistants'
import type {SourceLayoutOption} from '@domain/sync/layout'

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P]
}

export interface Source {
  name: string
  type: string
  layout?: SourceLayoutOption
  include?: string[]
  exclude?: string[]
  map?: string
  [key: string]: unknown
}

export const SOURCE_CONFLICT_STRATEGIES = {
  LAST_WINS: 'last-wins',
  FIRST_WINS: 'first-wins',
  ERROR: 'error',
} as const

export const LOCAL_CONFLICT_STRATEGIES = {
  REMOTE_WINS: 'remote-wins',
  LOCAL_WINS: 'local-wins',
  ERROR: 'error',
} as const

export type SourceConflictStrategy = (typeof SOURCE_CONFLICT_STRATEGIES)[keyof typeof SOURCE_CONFLICT_STRATEGIES]
export type LocalConflictStrategy = (typeof LOCAL_CONFLICT_STRATEGIES)[keyof typeof LOCAL_CONFLICT_STRATEGIES]

export interface SyncConfig {
  source_conflict_strategy: SourceConflictStrategy
  local_conflict_strategy: LocalConflictStrategy
  backup: boolean
  keep_local: boolean
  schedule?: string
}

export const SYNC_CONFIG_DEFAULTS: SyncConfig = {
  source_conflict_strategy: SOURCE_CONFLICT_STRATEGIES.LAST_WINS,
  local_conflict_strategy: LOCAL_CONFLICT_STRATEGIES.REMOTE_WINS,
  backup: true,
  keep_local: true,
}

export interface TelemetryConfig {
  enabled: boolean
  backend: string
}

export const TELEMETRY_DEFAULTS: TelemetryConfig = {
  enabled: false,
  backend: 'local',
}

export interface ProjectConfig {
  version: string
  project?: {
    name: string
    description?: string
  }
  assistants: AssistantConfig[]
  sources: Source[]
  sync?: Partial<SyncConfig>
  telemetry?: Partial<TelemetryConfig>
  lastSync?: string
}
