import {COMPONENT_FORMATS as F} from '../formats'
import {harnessesRegistry} from '../registry'
import type {HarnessDefinition} from '../types'

export const copilot: HarnessDefinition = {
  id: 'copilot',
  name: 'GitHub Copilot',
  detection: {
    directories: ['.github/instructions', '~/.copilot'],
    files: ['.github/copilot-instructions.md'],
  },
  targetMappings: [
    {sourceGlob: 'skills/**', destination: {project: '.github/skills/', global: '.copilot/skills/'}},
    {
      sourceGlob: 'rules/**',
      destination: {project: '.github/instructions/'},
      transforms: [
        {transformer: 'rename', params: {from: '.md', to: '.instructions.md'}},
        {transformer: 'frontmatter-rename', params: {from: 'paths', to: 'applyTo'}},
      ],
    },
  ],
  components: {
    skill: {project: '.github/skills/', global: '~/.copilot/skills/', format: F.SKILL_DIR},
    rule: {
      project: '.github/instructions/',
      global: '~/.github/instructions/',
      format: F.MARKDOWN,
      transforms: [
        {transformer: 'rename', params: {from: '.md', to: '.instructions.md'}},
        {transformer: 'frontmatter-rename', params: {from: 'paths', to: 'applyTo'}},
      ],
    },
  },
}

harnessesRegistry.push(copilot)
