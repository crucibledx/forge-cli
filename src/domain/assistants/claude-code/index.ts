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
    {sourceGlob: 'skills/**', destination: '.claude/skills/'},
    {sourceGlob: 'rules/**', destination: '.claude/rules/'},
    {sourceGlob: 'workflows/**', destination: '.claude/commands/'},
  ],
}

assistantsRegistry.push(claudeCode)
