import stripAnsi from 'strip-ansi'

import {CLI_ENTRY} from './constants'
import type {CLIResult, CLISession} from './spawn'
import {spawnInteractive} from './spawn'

// ─── Non-interactive command runner ──────────────────────────────────────────

/**
 * Runs a CLI command non-interactively (piped stdout/stderr, no PTY).
 * Suitable for commands like `sync` that don't prompt for user input.
 */
export async function runCommand(
  cwd: string,
  command: string,
  args: string[] = [],
  env: Record<string, string> = {},
): Promise<CLIResult> {
  const proc = Bun.spawn(['bun', 'run', CLI_ENTRY, command, ...args], {
    cwd,
    env: {...process.env, HOME: cwd, ...env},
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const exitCode = await proc.exited
  const output = stripAnsi(await new Response(proc.stdout).text())
  return {output, exitCode}
}

// ─── Per-command session runners ─────────────────────────────────────────────

/**
 * Runs `forge init` interactively, drives it via the `drive` callback,
 * then waits for the process to exit and returns the result.
 */
export async function runInitSession(cwd: string, drive: (cli: CLISession) => Promise<void>): Promise<CLIResult> {
  const cli = spawnInteractive(cwd, 'init')
  const done = cli.waitForExit()
  await drive(cli)
  return done
}

/**
 * Runs `forge config` interactively, drives it via the `drive` callback,
 * then waits for the process to exit and returns the result.
 */
export async function runConfigSession(cwd: string, drive: (cli: CLISession) => Promise<void>): Promise<CLIResult> {
  const cli = spawnInteractive(cwd, 'config')
  const done = cli.waitForExit()
  await drive(cli)
  return done
}

/**
 * Runs `forge sync` non-interactively. Returns stripped output and exit code.
 */
export async function runSync(cwd: string, args: string[] = []): Promise<CLIResult> {
  return runCommand(cwd, 'sync', args)
}

/**
 * Runs `forge status` non-interactively. Returns stripped output and exit code.
 */
export async function runStatus(cwd: string): Promise<CLIResult> {
  return runCommand(cwd, 'status')
}
