import {assistantsRegistry} from '../registry'
import type {AssistantDefinition} from '../types'

export const cursor: AssistantDefinition = {
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
}

assistantsRegistry.push(cursor)
