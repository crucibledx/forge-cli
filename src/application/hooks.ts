import {setGlobalMode} from '@infrastructure/io'
import type {LogLevel} from '@infrastructure/logger'
import {LOG_LEVELS, setLogLevel} from '@infrastructure/logger'

import type {CommandHook} from './commands/types'

const validLevels = new Set(Object.values(LOG_LEVELS))

export const setGlobalHook: CommandHook = {
  event: 'preAction',
  listener: (thisCommand) => {
    if (thisCommand.opts().global) setGlobalMode(true)
  },
}

export const setLogLevelHook: CommandHook = {
  event: 'preAction',
  listener: (thisCommand) => {
    const level = thisCommand.opts().logLevel as string | undefined
    if (level && validLevels.has(level as LogLevel)) {
      setLogLevel(level as LogLevel)
    }
  },
}
