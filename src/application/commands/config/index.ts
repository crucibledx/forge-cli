import {commandsRegistry} from '../registry'
import {runConfig} from './handler'
import {runConfigShow} from './subcommands/show'
import type {ConfigCommandDefinition} from './types'

export * from './types'

export const configCommand: ConfigCommandDefinition = {
  name: 'config',
  description: 'Interactively edit project configuration',
  options: [{flags: '-v, --verbose', description: 'Show debug output', defaultValue: false}],
  action: runConfig,
  subcommands: [
    {
      name: 'show',
      description: 'Display current configuration',
      options: [],
      action: runConfigShow,
    },
  ],
}

commandsRegistry.push(configCommand)
