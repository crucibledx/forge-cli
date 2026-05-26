import {commandsRegistry} from '../registry'
import {runStatus} from './handler'
import type {StatusCommandDefinition} from './types'

export * from './types'

export const statusCommand: StatusCommandDefinition = {
  name: 'status',
  description: 'Show drift between last sync and current filesystem',
  options: [],
  action: runStatus,
}

commandsRegistry.push(statusCommand)
