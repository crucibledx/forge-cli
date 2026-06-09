import type {CommandHook, CommandOption} from './commands/types'
import {setGlobalHook} from './hooks'

export const PROGRAM_MESSAGES = {
  globalOption: 'Operate on global config (~/.crucible/forge.config.yaml)',
}

export const programOptions: CommandOption[] = [
  {flags: '-g, --global', description: PROGRAM_MESSAGES.globalOption, defaultValue: false},
]

export const programHooks: CommandHook[] = [setGlobalHook]
