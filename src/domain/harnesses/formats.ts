export const COMPONENT_FORMATS = {
  /** A directory per skill with its `SKILL.md` and supporting files. */
  SKILL_DIR: 'skill-dir',
  /** Markdown files, one per resource. */
  MARKDOWN: 'markdown',
  /** A JSON file with an `mcpServers`-style object of servers. */
  MCP_JSON: 'mcp-json',
  /** Entries merged under `key` in a JSON settings file the harness shares with the user. */
  JSON_KEYS: 'json-keys',
} as const
export type ComponentFormatId = (typeof COMPONENT_FORMATS)[keyof typeof COMPONENT_FORMATS]
