import type {Command} from 'commander'

import {setGlobalMode} from '@domain/scope'
import type {LogLevel} from '@infrastructure/logger'
import {createFileLogger, LOG_LEVELS, setLogLevel} from '@infrastructure/logger'
import {
  createTelemetryService,
  getTelemetryContext,
  resetTelemetryContext,
  setTelemetryContext,
  TELEMETRY_EVENTS,
} from '@infrastructure/telemetry'
import type {TelemetryEventName} from '@infrastructure/telemetry/types'

import type {CommandHook} from './commands/types'

const validLevels = new Set(Object.values(LOG_LEVELS))

function resolveCommandName(actionCommand: Command): string {
  const parent = actionCommand.parent
  const isSubcommand = parent && parent.parent
  return isSubcommand ? `${parent.name()} ${actionCommand.name()}` : actionCommand.name()
}

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

export const debugCommandHook: CommandHook = {
  event: 'preAction',
  listener: (_thisCommand, actionCommand) => {
    const logger = createFileLogger()
    const name = resolveCommandName(actionCommand)
    logger.debug('command invoked', {cmd: name, options: actionCommand.opts()})
  },
}

const TRACKABLE_COMMANDS: Record<string, TelemetryEventName> = {
  sync: TELEMETRY_EVENTS.SYNC,
  init: TELEMETRY_EVENTS.INIT,
  config: TELEMETRY_EVENTS.CONFIG,
  status: TELEMETRY_EVENTS.STATUS,
  health: TELEMETRY_EVENTS.HEALTH,
  'scheduler install': TELEMETRY_EVENTS.SCHEDULER_INSTALL,
  'scheduler uninstall': TELEMETRY_EVENTS.SCHEDULER_UNINSTALL,
}

export const telemetryPreHook: CommandHook = {
  event: 'preAction',
  listener: () => {
    resetTelemetryContext()
    setTelemetryContext({startedAt: Date.now()})
  },
}

export const telemetryPostHook: CommandHook = {
  event: 'postAction',
  listener: async (_thisCommand, actionCommand) => {
    const cmdName = resolveCommandName(actionCommand)

    const eventName = TRACKABLE_COMMANDS[cmdName]
    if (!eventName) return

    try {
      const ctx = getTelemetryContext()
      const duration_ms = ctx.startedAt ? Date.now() - ctx.startedAt : 0
      const success = ctx.success ?? true
      const service = await createTelemetryService()
      await service.track({
        event: eventName,
        duration_ms,
        success,
        ...(ctx.file_count !== undefined ? {file_count: ctx.file_count} : {}),
      })
    } catch {
      // Telemetry must never break the CLI
    }
  },
}
