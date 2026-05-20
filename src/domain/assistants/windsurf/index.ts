import {assistantsRegistry} from '../registry'
import type {AssistantDefinition} from '../types'

export const windsurf: AssistantDefinition = {
  id: 'windsurf',
  name: 'Windsurf',
  detection: {
    directories: ['.windsurf', '~/.codeium/windsurf'],
    files: [],
  },
  targetMappings: [
    {sourceGlob: 'skills/**', destination: '.windsurf/skills/'},
    {
      sourceGlob: 'rules/**',
      destination: '.windsurf/rules/',
      transforms: [{transformer: 'frontmatter-rename', params: {from: 'paths', to: 'globs'}}],
    },
    {sourceGlob: 'workflows/**', destination: '.windsurf/workflows/'},
  ],
}

assistantsRegistry.push(windsurf)
