import {assistantsRegistry} from '../registry'
import type {AssistantDefinition} from '../types'

export const cline: AssistantDefinition = {
  id: 'cline',
  name: 'Cline',
  detection: {
    directories: ['.cline', '.clinerules', '~/.cline'],
    files: [],
  },
  targetMappings: [
    {sourceGlob: 'skills/**', destination: {project: '.cline/skills/'}},
    {sourceGlob: 'rules/**', destination: {project: '.clinerules/', global: 'Documents/Cline/Rules/'}},
    {
      sourceGlob: 'workflows/**',
      destination: {project: '.clinerules/workflows/', global: 'Documents/Cline/Workflows/'},
    },
  ],
}

assistantsRegistry.push(cline)
