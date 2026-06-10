import {commandsRegistry} from '../registry'
import type {CommandDefinition} from '../types'
import {runSourceAdd, runSourceList, runSourceRemove} from './handler'

export const sourceCommand: CommandDefinition = {
  name: 'source',
  description: 'Manage sync sources (add, remove, list)',
  options: [],
  action: runSourceList,
  subcommands: [
    {
      name: 'list',
      description: 'List configured sources and their sync status',
      options: [],
      action: runSourceList,
    },
    {
      name: 'add',
      description: 'Add a new source',
      options: [],
      action: runSourceAdd,
    },
    {
      name: 'remove',
      description: 'Remove a source and optionally clean synced files',
      options: [],
      action: runSourceRemove,
    },
  ],
}

commandsRegistry.push(sourceCommand)
