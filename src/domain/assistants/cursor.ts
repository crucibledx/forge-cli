import type {AssistantDefinition} from './types'

export const cursor: AssistantDefinition = {
    id: 'cursor',
    name: 'Cursor',
    detection: {
        directories: ['.cursor', '.cursor/rules'],
        files: [],
    },
    targetMappings: [
        {sourceGlob: 'skills/**', destination: '.cursor/skills/'},
        {sourceGlob: 'rules/**', destination: '.cursor/rules/', transform: 'rename:.md→.mdc'},
        {sourceGlob: 'workflows/**', destination: '.cursor/commands/'},
    ],
}
