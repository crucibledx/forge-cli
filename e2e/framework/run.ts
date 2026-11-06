import {CLI_ENTRY} from './constants'
import {runPipe} from './pipe'
import type {CLIResult, CLISession} from './spawn'
import {spawnInteractive} from './spawn'

function completed(result: CLIResult): CLIResult {
  if (result.timedOut)
    throw new Error(
      `Command deadline exceeded (exit ${result.exitCode}):\n${result.stdout || result.output}\n${result.stderr}`,
    )
  return result
}

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
  return completed(await runPipe(cwd, [process.execPath, 'run', CLI_ENTRY, command, ...args], {env}))
}

async function driveSession(cli: CLISession, drive: (cli: CLISession) => Promise<void>): Promise<CLIResult> {
  try {
    await drive(cli)
    return completed(await cli.waitForExit())
  } finally {
    await cli.dispose()
  }
}

// ─── Per-command session runners ─────────────────────────────────────────────

/**
 * Runs `forge init` interactively, drives it via the `drive` callback,
 * then waits for the process to exit and returns the result.
 */
export async function runInitSession(
  cwd: string,
  drive: (cli: CLISession) => Promise<void>,
  args: string[] = [],
): Promise<CLIResult> {
  const cli = spawnInteractive(cwd, 'init', args)
  return driveSession(cli, drive)
}

/**
 * Runs `forge config` interactively, drives it via the `drive` callback,
 * then waits for the process to exit and returns the result.
 */
export async function runConfigSession(cwd: string, drive: (cli: CLISession) => Promise<void>): Promise<CLIResult> {
  const cli = spawnInteractive(cwd, 'config')
  return driveSession(cli, drive)
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

/**
 * Runs `forge health` non-interactively.
 */
export async function runHealth(cwd: string): Promise<CLIResult> {
  return runCommand(cwd, 'health')
}

export async function runSource(cwd: string, subcommand: string, args: string[] = []): Promise<CLIResult> {
  return runCommand(cwd, 'source', [subcommand, ...args])
}

/**
 * Runs `forge source <subcommand>` interactively (PTY).
 */
export async function runSourceSession(
  cwd: string,
  subcommand: string,
  drive: (cli: CLISession) => Promise<void>,
): Promise<CLIResult> {
  const cli = spawnInteractive(cwd, 'source', [subcommand])
  return driveSession(cli, drive)
}

export async function runConfigShow(cwd: string): Promise<CLIResult> {
  return runCommand(cwd, 'config', ['show'])
}

export async function runScheduler(cwd: string, subcommand: string, args: string[] = []): Promise<CLIResult> {
  return runCommand(cwd, 'scheduler', [subcommand, ...args])
}

export async function runUninstallSession(cwd: string, drive: (cli: CLISession) => Promise<void>): Promise<CLIResult> {
  const cli = spawnInteractive(cwd, 'uninstall')
  return driveSession(cli, drive)
}

export async function runInit(cwd: string, args: string[] = []): Promise<CLIResult> {
  return runCommand(cwd, 'init', args)
}

export async function runTelemetry(cwd: string, args: string[] = []): Promise<CLIResult> {
  return runCommand(cwd, 'telemetry', args)
}
