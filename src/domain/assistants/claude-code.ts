import type {AssistantDefinition} from './types'

export const claudeCode: AssistantDefinition = {
    id: 'claude-code',
    name: 'Claude Code',
    detection: {
        directories: ['.claude', '.claude/skills', '.claude/rules'],
        files: ['.claude/settings.json', 'CLAUDE.md'],
    },
    targetMappings: [
        {sourceGlob: 'skills/**', destination: '.claude/skills/'},
        {sourceGlob: 'rules/**', destination: '.claude/rules/'},
        {sourceGlob: 'workflows/**', destination: '.claude/commands/'},
    ],
}
