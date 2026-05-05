#!/usr/bin/env bun

import {commands} from '@application/commands'
import {createProgram} from '@infrastructure/cli'

const program = createProgram(commands)
await program.parseAsync()
process.exit(0)
