import {Command} from 'commander'

import type {CommandDefinition} from '@application/commands/types'
import {CommandError} from '@application/commands/types'

import pkg from '../../../package.json'
import * as renderer from './renderer'

export const PROGRAM_DETAILS = {
  name: Object.keys(pkg.bin)[0],
  description: pkg.description,
  version: pkg.version,
}

export function createProgram(commands: CommandDefinition[]): Command {
  const program = new Command()
    .name(PROGRAM_DETAILS.name)
    .description(PROGRAM_DETAILS.description)
    .version(PROGRAM_DETAILS.version)

  for (const cmd of commands) {
    const command = program.command(cmd.name).description(cmd.description)
    applyOptions(command, cmd.options)

    command.action(wrapAction(cmd.action))

    if (cmd.subcommands?.length) {
      registerSubcommands(command, cmd.subcommands)
    }
  }

  return program

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function wrapAction(action: (options: any) => Promise<void>) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return async (options: any) => {
      try {
        await action(options)
      } catch (err) {
        renderer.renderNewline()
        if (err instanceof CommandError) {
          renderer.renderError(err.message, err.suggestion)
        } else {
          renderer.renderError(err instanceof Error ? err.message : String(err))
        }
        process.exit(1)
      }
    }
  }

  function applyOptions(command: Command, options: CommandDefinition['options']): void {
    options.forEach((opt) => command.option(opt.flags, opt.description, opt.defaultValue))
  }

  function registerSubcommands(parent: Command, subcommands: NonNullable<CommandDefinition['subcommands']>): void {
    for (const sub of subcommands) {
      const subcmd = parent.command(sub.name).description(sub.description)
      applyOptions(subcmd, sub.options)
      subcmd.action(wrapAction(sub.action))
    }
  }
}
