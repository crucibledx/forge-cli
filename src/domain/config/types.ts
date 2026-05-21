import type {AssistantConfig} from '@domain/assistants'

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P]
}

export interface Source {
  name: string
  type: string
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
}

export const SYNC_CONFIG_DEFAULTS: SyncConfig = {
  source_conflict_strategy: SOURCE_CONFLICT_STRATEGIES.LAST_WINS,
  local_conflict_strategy: LOCAL_CONFLICT_STRATEGIES.REMOTE_WINS,
  backup: true,
  keep_local: true,
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
  lastSync?: string
}
