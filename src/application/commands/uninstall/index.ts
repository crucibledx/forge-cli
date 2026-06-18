import {commandsRegistry} from '../registry'
import type {CommandDefinition} from '../types'
import {runUninstall} from './handler'

export const uninstallCommand: CommandDefinition = {
  name: 'uninstall',
  description: 'Remove forge configuration, synced files, and scheduler from this project',
  options: [],
  action: runUninstall,
}

commandsRegistry.push(uninstallCommand)
