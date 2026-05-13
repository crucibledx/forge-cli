import type {CommandDefinition} from '../types'

export interface ConfigOptions {
    verbose: boolean
}

export type ConfigCommandAction = (options: ConfigOptions) => Promise<void>

export interface ConfigCommandDefinition extends CommandDefinition {
    action: ConfigCommandAction
}
