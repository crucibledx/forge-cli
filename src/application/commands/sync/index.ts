import {commandsRegistry} from '../registry'
import {runSync} from './handler'
import type {SyncCommandDefinition} from './types'

export * from './types'

export const syncCommand: SyncCommandDefinition = {
  name: 'sync',
  description: 'Fetch shared skills & workflows from configured source',
  options: [
    {flags: '--dry-run', description: 'Preview changes without writing', defaultValue: false},
    {flags: '-v, --verbose', description: 'Show debug output', defaultValue: false},
    {flags: '--silent', description: 'Suppress all output (for scheduled runs)', defaultValue: false},
  ],
  action: runSync,
}

commandsRegistry.push(syncCommand)
