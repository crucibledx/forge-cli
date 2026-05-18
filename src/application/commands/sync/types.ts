import type {CommandDefinition} from '../types'

export interface SyncOptions {
  dryRun: boolean
  verbose: boolean
}

export type SyncCommandAction = (options: SyncOptions) => Promise<void>

export interface SyncCommandDefinition extends CommandDefinition {
  action: SyncCommandAction
}
