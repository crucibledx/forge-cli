export const ASSISTANT_IDS = ['claude-code', 'cursor', 'windsurf', 'copilot', 'cline'] as const
export type AssistantId = (typeof ASSISTANT_IDS)[number]

export interface TargetMapping {
    sourceGlob: string
    destination: string
    transform?: string        // filename transform, e.g. "rename:.md→.mdc"
    contentTransform?: string // content transform, e.g. "frontmatter:paths→globs"
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
