import type {CommandDefinition} from '../types'

export interface InitOptions {
  verbose: boolean
  force: boolean
}

export type InitCommandAction = (options: InitOptions) => Promise<void>

export interface InitCommandDefinition extends CommandDefinition {
  action: InitCommandAction
}
