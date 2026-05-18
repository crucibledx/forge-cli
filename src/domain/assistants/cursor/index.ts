import type {AssistantDefinition} from '../types'

export const cursor: AssistantDefinition = {
  id: 'cursor',
  name: 'Cursor',
  detection: {
    directories: ['.cursor'],
    files: ['.cursorrules', '~/.cursor/mcp.json'],
  },
  targetMappings: [
    {sourceGlob: 'skills/**', destination: '.cursor/skills/'},
    {
      sourceGlob: 'rules/**',
      destination: '.cursor/rules/',
      transform: 'rename:.md→.mdc',
      contentTransform: 'frontmatter:paths→globs',
    },
    {sourceGlob: 'workflows/**', destination: '.cursor/commands/'},
  ],
}
