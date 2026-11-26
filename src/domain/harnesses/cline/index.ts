import {harnessesRegistry} from '../registry'
import type {HarnessDefinition} from '../types'

export const cline: HarnessDefinition = {
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

harnessesRegistry.push(cline)
