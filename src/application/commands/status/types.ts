import type {CommandDefinition} from '../types'

export type StatusCommandAction = (options: Record<string, never>) => Promise<void>

export interface StatusCommandDefinition extends CommandDefinition {
  action: StatusCommandAction
}
