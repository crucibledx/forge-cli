import type {TransformStep} from '../transforms/types'

export type AssistantId = string

export interface TargetMapping {
  sourceGlob: string
  destination: string
  transforms?: TransformStep[]
}

export interface DetectionRule {
  directories: string[]
  // TODO: use pattern in files,
  //  e.g. '.claude/settings*.json' to match both '.claude/settings.json' and '.claude/settings.examples.json'
  files: string[]
}

export interface AssistantDefinition {
  id: AssistantId
  name: string
  detection: DetectionRule
  targetMappings: TargetMapping[]
}

export interface DetectionResult {
  id: AssistantId
  name: string
  detected: boolean
  scope?: 'project' | 'global'
  evidence?: string // e.g., ".claude/ directory found, 3 items"
}

export interface AssistantConfig {
  id: AssistantId
  enabled: boolean
  config?: Record<string, unknown>
}
