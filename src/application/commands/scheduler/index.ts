import {commandsRegistry} from '../registry'
import type {CommandDefinition} from '../types'
import {runScheduler, runSchedulerInstall, runSchedulerStatus, runSchedulerUninstall} from './handler'

export const schedulerCommand: CommandDefinition = {
  name: 'scheduler',
  description: 'Manage automatic sync scheduling',
  options: [],
  action: runScheduler,
  subcommands: [
    {
      name: 'install',
      description: 'Register a scheduled sync task with your OS',
      options: [],
      action: runSchedulerInstall,
    },
    {
      name: 'uninstall',
      description: 'Remove the scheduled sync task',
      options: [],
      action: runSchedulerUninstall,
    },
    {
      name: 'status',
      description: 'Show scheduler status and next run time',
      options: [],
      action: runSchedulerStatus,
    },
  ],
}

commandsRegistry.push(schedulerCommand)
