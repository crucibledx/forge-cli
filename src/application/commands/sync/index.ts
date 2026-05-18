import {runSync} from './handler'
import type {SyncCommandDefinition} from './types'

export * from './types'

export const syncCommand: SyncCommandDefinition = {
  name: 'sync',
  description: 'Fetch shared skills & workflows from configured source',
  options: [
    {flags: '--dry-run', description: 'Preview changes without writing', defaultValue: false},
    {flags: '-v, --verbose', description: 'Show debug output', defaultValue: false},
  ],
  action: runSync,
}
