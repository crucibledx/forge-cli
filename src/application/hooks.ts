import {setGlobalMode} from '@infrastructure/io'

import type {CommandHook} from './commands/types'

export const setGlobalHook: CommandHook = {
  event: 'preAction',
  listener: (thisCommand) => {
    if (thisCommand.opts().global) setGlobalMode(true)
  },
}
