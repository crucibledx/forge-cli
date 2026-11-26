import {COMPONENT_FORMATS as F} from '../formats'
import {harnessesRegistry} from '../registry'
import type {HarnessDefinition} from '../types'

export const cursor: HarnessDefinition = {
  id: 'cursor',
  name: 'Cursor',
  detection: {
    directories: ['.cursor'],
    files: ['.cursorrules', '~/.cursor/mcp.json'],
  },
  targetMappings: [
    {sourceGlob: 'skills/**', destination: {project: '.cursor/skills/'}},
    {
      sourceGlob: 'rules/**',
      destination: {project: '.cursor/rules/'},
      transforms: [
        {transformer: 'rename', params: {from: '.md', to: '.mdc'}},
        {transformer: 'frontmatter-rename', params: {from: 'paths', to: 'globs'}},
      ],
    },
    {sourceGlob: 'workflows/**', destination: {project: '.cursor/commands/'}},
  ],
  components: {
    skill: {project: '.cursor/skills/', global: '~/.cursor/skills/', format: F.SKILL_DIR},
    rule: {
      project: '.cursor/rules/',
      global: '~/.cursor/rules/',
      format: F.MARKDOWN,
      transforms: [
        {transformer: 'rename', params: {from: '.md', to: '.mdc'}},
        {transformer: 'frontmatter-rename', params: {from: 'paths', to: 'globs'}},
      ],
    },
    command: {project: '.cursor/commands/', global: '~/.cursor/commands/', format: F.MARKDOWN},
  },
}

harnessesRegistry.push(cursor)
