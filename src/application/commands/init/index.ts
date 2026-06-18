import {commandsRegistry} from '../registry'
import {runInit} from './handler'
import type {InitCommandDefinition} from './types'

export * from './types'

export const initCommand: InitCommandDefinition = {
  name: 'init',
  description: 'Initialize AI assistant config in this project',
  options: [
    {flags: '-v, --verbose', description: 'Show debug output', defaultValue: false},
    {flags: '-f, --force', description: 'Overwrite existing configuration', defaultValue: false},
  ],
  action: runInit,
}

commandsRegistry.push(initCommand)
