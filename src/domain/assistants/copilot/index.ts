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
      transforms: [
        {transformer: 'rename', params: {from: '.md', to: '.instructions.md'}},
        {transformer: 'frontmatter-rename', params: {from: 'paths', to: 'applyTo'}},
      ],
    },
  ],
}

assistantsRegistry.push(copilot)
