import type {AssistantDefinition} from '../types'

export const cline: AssistantDefinition = {
    id: 'cline',
    name: 'Cline',
    detection: {
        directories: ['.cline', '.clinerules', '~/.cline'],
        files: [],
    },
    targetMappings: [
        {sourceGlob: 'skills/**', destination: '.cline/skills/'},
        {sourceGlob: 'rules/**', destination: '.clinerules/'},
        {sourceGlob: 'workflows/**', destination: '.clinerules/workflows/'},
    ],
}
