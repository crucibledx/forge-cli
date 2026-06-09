import type {CommandDefinition} from '../types'

export type HealthCommandAction = (options: Record<string, never>) => Promise<void>

export interface HealthCommandDefinition extends CommandDefinition {
  action: HealthCommandAction
}
