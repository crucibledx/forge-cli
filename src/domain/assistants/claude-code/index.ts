import {assistantsRegistry} from '../registry'
import type {AssistantDefinition} from '../types'

export const claudeCode: AssistantDefinition = {
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
}

assistantsRegistry.push(claudeCode)
