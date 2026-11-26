import {harnessesRegistry} from '../registry'
import type {HarnessDefinition} from '../types'

export const windsurf: HarnessDefinition = {
  id: 'windsurf',
  name: 'Windsurf',
  detection: {
    directories: ['.windsurf', '~/.codeium/windsurf'],
    files: [],
  },
  targetMappings: [
    {
      sourceGlob: 'skills/**',
      destination: {project: '.windsurf/skills/', global: '.codeium/windsurf/skills/'},
    },
    {
      sourceGlob: 'rules/**',
      destination: {project: '.windsurf/rules/', global: '.codeium/windsurf/rules/'},
      transforms: [{transformer: 'frontmatter-rename', params: {from: 'paths', to: 'globs'}}],
    },
    {
      sourceGlob: 'workflows/**',
      destination: {project: '.windsurf/workflows/', global: '.codeium/windsurf/global_workflows/'},
    },
  ],
}

harnessesRegistry.push(windsurf)
