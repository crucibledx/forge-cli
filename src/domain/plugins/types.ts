export const PLUGIN_HARNESSES = {CLAUDE_CODE: 'claude-code', DROID: 'droid'} as const
export type PluginHarnessId = (typeof PLUGIN_HARNESSES)[keyof typeof PLUGIN_HARNESSES]
export const PLUGIN_HARNESS_IDS: readonly PluginHarnessId[] = Object.values(PLUGIN_HARNESSES)

export const FORGE_NAMESPACE = 'dev.crucibledx.forge'
/** A harness's own extension folder wins over `dev.crucibledx.forge/`, which wins over portable components. */
export const VENDOR_NAMESPACES: Readonly<Record<PluginHarnessId, string>> = {
  [PLUGIN_HARNESSES.CLAUDE_CODE]: 'com.anthropic',
  [PLUGIN_HARNESSES.DROID]: 'ai.factory',
}

export const PLUGIN_COMPONENT_KINDS = {
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
export type PluginComponentKind = (typeof PLUGIN_COMPONENT_KINDS)[keyof typeof PLUGIN_COMPONENT_KINDS]

/** A package file; `path` is relative to the package root and always uses `/`. */
export interface PluginFile {
  path: string
  content: Uint8Array
}

export interface PluginManifest {
  name: string
  version: string
  description?: string
  forge: {minForgeVersion?: string; harnesses?: string[]}
}

export interface PluginComponent {
  kind: PluginComponentKind
  name: string
  /** Layer the component came from: `''` for portable, otherwise the extension namespace. */
  origin: string
  /** Package path of the component's file or directory. */
  root: string
  files: PluginFile[]
  /** Rules only: the frontmatter declares `paths`. */
  pathScoped?: boolean
}

/** The parsed package. Emitters read only this record. */
export interface PluginPackage {
  manifest: PluginManifest
  files: PluginFile[]
  components: Record<PluginHarnessId, PluginComponent[]>
  warnings: string[]
}

export const PLUGIN_SCOPES = {PROJECT: 'project', USER: 'user'} as const
export type PluginScope = (typeof PLUGIN_SCOPES)[keyof typeof PLUGIN_SCOPES]

export type PluginSourceConfig =
  {type: 'local'; path: string} | {type: 'git'; url: string; path?: string; ref?: string; branch?: string}

export interface PluginConfig {
  name: string
  source: PluginSourceConfig
  harnesses?: string[]
  scope?: PluginScope
}

/** Everything forge delivers to one harness for one plugin, keyed scope-independently for `outputs` hashing. */
export interface DeliveredFiles {
  plugin: PluginFile[]
  claudeRules?: PluginFile[]
}
