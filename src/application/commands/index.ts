import {configCommand} from './config'
import {initCommand} from './init'
import {syncCommand} from './sync'
import type {CommandDefinition} from './types'

export type * from './types'

export const commands: CommandDefinition[] = [initCommand, syncCommand, configCommand]
