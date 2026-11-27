import {COMPONENT_FORMATS as F} from '../formats'
import {harnessesRegistry} from '../registry'
import type {HarnessDefinition} from '../types'

export const claudeCode: HarnessDefinition = {
  id: 'claude-code',
  name: 'Claude Code',
  detection: {
    directories: ['.claude', '~/.claude'],
    files: ['CLAUDE.md', '.claude/settings.json'],
  },
  targetMappings: [
    {sourceGlob: 'skills/**', destination: {project: '.claude/skills/'}},
    {sourceGlob: 'rules/**', destination: {project: '.claude/rules/'}},
    {sourceGlob: 'workflows/**', destination: {project: '.claude/commands/'}},
  ],
  components: {
    skill: {project: '.claude/skills/', global: '~/.claude/skills/', format: F.SKILL_DIR},
    rule: {project: '.claude/rules/', global: '~/.claude/rules/', format: F.MARKDOWN},
    command: {project: '.claude/commands/', global: '~/.claude/commands/', format: F.MARKDOWN},
    agent: {project: '.claude/agents/', global: '~/.claude/agents/', format: F.MARKDOWN},
    hook: {project: '.claude/settings.json', global: '~/.claude/settings.json', format: F.JSON_KEYS, key: 'hooks'},
    mcp: {project: '.mcp.json', format: F.MCP_JSON, key: 'mcpServers'},
    'output-style': {project: '.claude/output-styles/', global: '~/.claude/output-styles/', format: F.MARKDOWN},
  },
  plugin: {
    emit: 'claude',
    register: 'claude-settings',
    installNote: 'installs on next start, once you trust the folder',
  },
}

harnessesRegistry.push(claudeCode)
