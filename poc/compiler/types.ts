export const KINDS = { SKILL: 'skill', AGENT: 'agent', COMMAND: 'command', RULE: 'rule', HOOK: 'hook', MCP: 'mcp' } as const
export type Kind = (typeof KINDS)[keyof typeof KINDS]

export const STATUSES = { KEPT: 'kept', DEFERRED: 'deferred', SHAKEN: 'shaken', DEDUPED: 'deduped', INVALID: 'invalid' } as const
export type Status = (typeof STATUSES)[keyof typeof STATUSES]

export interface Component {
  id: string // `${kind}:${name}`
  kind: Kind
  name: string
  plugin: string
  source: string
  category?: string
  dir: string // absolute directory that is copied on emit (skill dir) or the file's dir
  file: string // absolute path of the primary file
  frontmatter: Record<string, unknown>
  description: string
  body: string
  hash: string
  labels: string[]
  deps: string[] // component ids
  status: Status
  reasons: string[]
  diagnostics: string[]
}

export interface SourceConfig {
  name: string
  type: 'claude-marketplace' | 'factory-marketplace' | 'loose'
  path: string
}

export interface CompileConfig {
  sources: SourceConfig[]
  profile?: { include?: string[]; exclude?: string[] }
  keep?: string[] // component names always kept
  pin?: string[] // skills that stay native in guardian mode
  categories?: { allow?: string[] }
  budget?: { skillChars?: number; agentChars?: number; agentDescChars?: number }
  minify?: { descriptionChars?: number }
}

export interface Profile {
  tags: string[]
  evidence: Record<string, string>
}
