import {commandsRegistry} from '../registry'
import type {CommandDefinition} from '../types'
import {runPlugin, runPluginValidate} from './handler'
import {PLUGIN_MESSAGES as M} from './messages'

export const pluginCommand: CommandDefinition = {
  name: 'plugin',
  description: M.description,
  options: [],
  action: runPlugin,
  subcommands: [
    {
      name: 'validate [path]',
      description: M.validate.description,
      options: [{flags: '--json', description: M.validate.jsonOption, defaultValue: false}],
      action: runPluginValidate,
    },
  ],
}

commandsRegistry.push(pluginCommand)
