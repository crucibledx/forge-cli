import type {HarnessConfig} from '@domain/harnesses'
import type {PluginConfig, PluginHarnessId} from '@domain/plugins'
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

export const COMPILE_PROFILE_MODES = {RANK: 'rank', PRUNE: 'prune'} as const
export type CompileProfileMode = (typeof COMPILE_PROFILE_MODES)[keyof typeof COMPILE_PROFILE_MODES]
export type CompileProfile =
  false | CompileProfileMode | {mode: CompileProfileMode; include?: string[]; exclude?: string[]}
export type CompileGuardianSwitch = 'auto' | 'on' | 'off'
export type CompileGuardian = 'off' | {hook: CompileGuardianSwitch; mcp: CompileGuardianSwitch; min_score: number}

/** The raw `compile:` block as parsed from forge.config.yaml; every field optional, defaults apply. */
export interface CompileConfigInput {
  enabled?: boolean
  priority?: string[]
  keep?: string[]
  defer?: string[]
  profile?: false | CompileProfileMode | {mode: CompileProfileMode; include?: string[]; exclude?: string[]}
  guardian?: 'off' | {hook?: CompileGuardianSwitch; mcp?: CompileGuardianSwitch; min_score?: number}
  harnesses?: Partial<Record<PluginHarnessId, CompileHarnessOverride>>
}

/** §4 harness-data overrides: a budget as a character count or `off`, a description cap as a count. */
export interface CompileHarnessOverride {
  skills?: number | 'off'
  agents?: number | 'off'
  commands?: number | 'off'
  skill_description?: number
  agent_description?: number
}

/** Spec 0005 §2, defaults applied (COMPILE_CONFIG_DEFAULTS). Lives in the config of the scope it compiles. */
export interface CompileConfig {
  enabled: boolean
  priority: string[]
  keep: string[]
  defer: string[]
  profile: CompileProfile
  guardian: CompileGuardian
  harnesses: Partial<Record<PluginHarnessId, CompileHarnessOverride>>
}

export const COMPILE_CONFIG_DEFAULTS: CompileConfig = {
  enabled: true,
  priority: [],
  keep: [],
  defer: [],
  profile: false,
  guardian: {hook: 'auto', mcp: 'auto', min_score: 6},
  harnesses: {},
}

/** The effective compile config: the user's `compile:` block merged over the defaults. */
export function effectiveCompileConfig(raw?: CompileConfigInput): CompileConfig {
  if (!raw) return COMPILE_CONFIG_DEFAULTS
  const guardian =
    raw.guardian === 'off'
      ? raw.guardian
      : typeof raw.guardian === 'object' && raw.guardian !== null
        ? {hook: 'auto' as const, mcp: 'auto' as const, min_score: 6, ...raw.guardian}
        : COMPILE_CONFIG_DEFAULTS.guardian
  return {
    enabled: raw.enabled ?? COMPILE_CONFIG_DEFAULTS.enabled,
    priority: raw.priority ?? COMPILE_CONFIG_DEFAULTS.priority,
    keep: raw.keep ?? COMPILE_CONFIG_DEFAULTS.keep,
    defer: raw.defer ?? COMPILE_CONFIG_DEFAULTS.defer,
    profile: raw.profile ?? COMPILE_CONFIG_DEFAULTS.profile,
    guardian,
    harnesses: raw.harnesses ?? COMPILE_CONFIG_DEFAULTS.harnesses,
  }
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
  harnesses: HarnessConfig[]
  sources: Source[]
  plugins?: PluginConfig[]
  compile?: CompileConfigInput
  sync?: Partial<SyncConfig>
  telemetry?: Partial<TelemetryConfig>
  lastSync?: string
}
