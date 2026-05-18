import {Command} from 'commander'

import type {CommandDefinition} from '@application/commands/types'

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

    cmd.options.forEach((opt) => command.option(opt.flags, opt.description, opt.defaultValue))

    command.action(async (options) => {
      try {
        await cmd.action(options)
      } catch (err) {
        renderer.renderNewline()
        renderer.renderError(err instanceof Error ? err.message : String(err))
        process.exit(1)
      }
    })
  }

  return program
}
