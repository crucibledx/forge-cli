#!/usr/bin/env bun

import '@domain/transforms'

import {commands} from '@application/commands'
import {programHooks, programOptions} from '@application/program'
import {createProgram} from '@infrastructure/cli'

const program = createProgram(commands)
programOptions.forEach((opt) => program.option(opt.flags, opt.description, opt.defaultValue))
programHooks.forEach((hook) => program.hook(hook.event, hook.listener))

await program.parseAsync()
process.exit(0)
