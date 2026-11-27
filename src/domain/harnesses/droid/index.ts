import {COMPONENT_FORMATS as F} from '../formats'
import {harnessesRegistry} from '../registry'
import type {HarnessDefinition} from '../types'

/**
 * Droid documents no rules directory: always-on instructions come from AGENTS.md, which forge does not share with
 * the user. Loose `rules/**` therefore have no Droid mapping and sync reports them as not delivered.
 */
export const droid: HarnessDefinition = {
  id: 'droid',
  name: 'Droid',
  detection: {
    directories: ['.factory', '~/.factory'],
    files: [],
  },
  targetMappings: [
    {sourceGlob: 'skills/**', destination: {project: '.factory/skills/'}},
    {sourceGlob: 'workflows/**', destination: {project: '.factory/commands/'}},
  ],
  components: {
    skill: {project: '.factory/skills/', global: '~/.factory/skills/', format: F.SKILL_DIR},
    command: {project: '.factory/commands/', global: '~/.factory/commands/', format: F.MARKDOWN},
    agent: {project: '.factory/droids/', global: '~/.factory/droids/', format: F.MARKDOWN},
    mcp: {global: '~/.factory/mcp.json', format: F.MCP_JSON, key: 'mcpServers'},
    'output-style': {project: '.factory/output-styles/', format: F.MARKDOWN},
  },
}

harnessesRegistry.push(droid)
