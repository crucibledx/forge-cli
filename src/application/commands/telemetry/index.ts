import {commandsRegistry} from '../registry'
import type {CommandDefinition} from '../types'
import {runTelemetryReset, runTelemetryStatus} from './handler'

export const telemetryCommand: CommandDefinition = {
  name: 'telemetry',
  description: 'Show telemetry status, collected data types, and how to configure',
  options: [],
  action: runTelemetryStatus,
  subcommands: [
    {
      name: 'status',
      description: 'Show current telemetry configuration and event stats',
      options: [],
      action: runTelemetryStatus,
    },
    {
      name: 'reset',
      description: 'Clear all stored telemetry events',
      options: [],
      action: runTelemetryReset,
    },
  ],
}

commandsRegistry.push(telemetryCommand)
