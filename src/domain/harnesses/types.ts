import type {TransformStep} from '../transforms/types'
import type {ComponentFormatId} from './formats'

export type HarnessId = string

export interface TargetDestination {
  project: string
  global?: string
}

export interface TargetMapping {
  sourceGlob: string
  destination: TargetDestination
  transforms?: TransformStep[]
}

export interface DetectionRule {
  directories: string[]
  // TODO: use pattern in files,
  //  e.g. '.claude/settings*.json' to match both '.claude/settings.json' and '.claude/settings.examples.json'
  files: string[]
}

export interface HarnessDefinition {
  id: HarnessId
  name: string
  detection: DetectionRule
  /** v0.7 loose-resource sync. */
  targetMappings: TargetMapping[]
  /** What the harness can load, and where. A missing kind means the harness has no such concept. */
  components: Partial<Record<ComponentKind, ComponentTarget>>
  plugin?: HarnessPluginCapability
}

export interface DetectionResult {
  id: HarnessId
  name: string
  detected: boolean
  scope?: 'project' | 'global'
  evidence?: string // e.g., ".claude/ directory found, 3 items"
}

export interface HarnessConfig {
  id: HarnessId
  enabled: boolean
  config?: Record<string, unknown>
}

export const COMPONENT_KINDS = {
  SKILL: 'skill',
  RULE: 'rule',
  COMMAND: 'command',
  AGENT: 'agent',
  HOOK: 'hook',
  MCP: 'mcp',
  LSP: 'lsp',
  OUTPUT_STYLE: 'output-style',
  SETTING: 'setting',
} as const
export type ComponentKind = (typeof COMPONENT_KINDS)[keyof typeof COMPONENT_KINDS]

export interface ComponentTarget {
  /** Path relative to the project root; a directory ends with '/', a file does not. */
  project?: string
  /** Path relative to home, with a '~/' prefix. */
  global?: string
  format: ComponentFormatId
  /** For keyed formats: the JSON key path to merge under, e.g. 'mcpServers'. */
  key?: string
  transforms?: TransformStep[]
}

/** Shape from spec 0003 §5. Set only on harnesses whose plugin emitter and registrar exist. */
export interface HarnessPluginCapability {
  emit: string
  register: string
  /** Shown under the harness's plugin lines in the sync plan and report, e.g. when the harness picks plugins up. */
  installNote?: string
}
