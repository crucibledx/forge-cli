import {assistantsRegistry} from '../registry'
import type {AssistantDefinition} from '../types'

export const copilot: AssistantDefinition = {
  id: 'copilot',
  name: 'GitHub Copilot',
  detection: {
    directories: ['.github/instructions', '~/.copilot'],
    files: ['.github/copilot-instructions.md'],
  },
  targetMappings: [
    {sourceGlob: 'skills/**', destination: '.github/skills/'},
    {
      sourceGlob: 'rules/**',
      destination: '.github/instructions/',
      transform: 'rename:.md→.instructions.md',
      contentTransform: 'frontmatter:paths→applyTo',
    },
  ],
}

assistantsRegistry.push(copilot)
