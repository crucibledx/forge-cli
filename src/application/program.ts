import type {CommandHook, CommandOption} from './commands/types'
import {setGlobalHook, setLogLevelHook} from './hooks'

export const PROGRAM_MESSAGES = {
  globalOption: 'Operate on global config (~/.crucible/forge.config.yaml)',
  logLevelOption: 'Set file log level (silent, error, warn, info, debug, trace)',
}

export const programOptions: CommandOption[] = [
  {flags: '-g, --global', description: PROGRAM_MESSAGES.globalOption, defaultValue: false},
  {flags: '--log-level <level>', description: PROGRAM_MESSAGES.logLevelOption, defaultValue: 'info'},
]

export const programHooks: CommandHook[] = [setGlobalHook, setLogLevelHook]
