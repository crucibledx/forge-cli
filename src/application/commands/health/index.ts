import {commandsRegistry} from '../registry'
import {runHealth} from './handler'
import type {HealthCommandDefinition} from './types'

export * from './types'

export const healthCommand: HealthCommandDefinition = {
  name: 'health',
  description: 'Show health dashboard — sync status, drift, sources, logs',
  options: [],
  action: runHealth,
}

commandsRegistry.push(healthCommand)
