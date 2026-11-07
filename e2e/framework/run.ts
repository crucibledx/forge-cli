import {CLI_ENTRY} from './constants'
import {sessionFailure} from './failure'
import {runPipe} from './pipe'
import {SESSION_MS} from './process'
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
  execute = runPipe,
): Promise<CLIResult> {
  const argv = [process.execPath, 'run', CLI_ENTRY, command, ...args]
  const replay = {seed: env.FC_SEED ?? process.env.FC_SEED ?? null, replay: env.FC_PATH ?? process.env.FC_PATH ?? null}
  const result = await execute(cwd, argv, {env})
  if (result.timedOut)
    throw sessionFailure(
      [new Error('Command deadline exceeded')],
      {
        command: argv,
        cwd,
        exit: result.exitCode,
        signal: result.signal,
        timedOut: true,
        timeoutMs: SESSION_MS,
        ...replay,
      },
      `${result.stdout || result.output}\n${result.stderr}`,
    )
  return result
}

export async function driveSession(cli: CLISession, drive: (cli: CLISession) => Promise<void>): Promise<CLIResult> {
  let timer: ReturnType<typeof setTimeout> | undefined
  let result: CLIResult | undefined
  const errors: unknown[] = []
  try {
    await Promise.race([
      Promise.resolve().then(() => drive(cli)),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Command deadline exceeded while driving session')),
          Math.max(0, cli.deadlineAt - performance.now()),
        )
      }),
    ])
    result = await cli.waitForExit()
    if (result.timedOut) throw new Error('Command deadline exceeded while waiting for session exit')
  } catch (error) {
    errors.push(error)
  } finally {
    clearTimeout(timer)
    try {
      await cli.dispose()
    } catch (error) {
      errors.push(error)
    }
  }
  if (errors.length) throw cli.failure(errors)
  return result!
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
  spawn = spawnInteractive,
): Promise<CLIResult> {
  const cli = spawn(cwd, 'init', args)
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
