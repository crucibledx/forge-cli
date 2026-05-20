import stripAnsi from 'strip-ansi'

import {CLI_ENTRY, TIMEOUT_MS} from './constants'
import {ENTER} from './keys'

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CLIResult {
  output: string
  exitCode: number
}

/**
 * A fluent step returned by `CLISession.waitForText`. It is a real Promise
 * (awaitable) and exposes action methods that fire immediately after the wait
 * resolves, then return the same step so you can keep chaining:
 *
 *   await cli
 *       .waitForText(M.assistants.addUndetected('Claude Code')).pressKey(N)
 *       .waitForText(M.assistants.addUndetected('Cursor')).pressKey(Y)
 *       .waitForText(M.source.branch).pressEnter()
 */
export interface CliStep extends Promise<void> {
  /** Send a single key after this step settles */
  pressKey(key: string): CliStep

  /** Press Enter after this step settles */
  pressEnter(): CliStep

  /** Write text after this step settles */
  write(text: string): CliStep

  /** Wait for the next prompt text, chained after this step */
  waitForText(text: string, timeoutMs?: number): CliStep
}

export interface CLISession {
  /** Strip-ANSI snapshot of all output so far */
  getOutput(): string

  /** Begin a fluent interaction chain by waiting for `text` to appear */
  waitForText(text: string, timeoutMs?: number): CliStep

  /** Resolves once the subprocess exits */
  waitForExit(): Promise<CLIResult>
}

// ─── Spawn ───────────────────────────────────────────────────────────────────

/**
 * Spawns `bun run <CLI_ENTRY> <command> [...args]` inside Bun's built-in PTY
 * (Bun.spawn `terminal` option, available since v1.3.5).
 *
 * The child process sees isTTY=true so @clack/prompts enters raw mode and
 * confirm prompts respond to a single 'y'/'n' keypress without ENTER.
 *
 * Use `waitForText` before each `pressKey` — no fixed sleeps needed.
 */
export function spawnInteractive(
  cwd: string,
  command: string,
  args: string[] = [],
  env: Record<string, string> = {},
): CLISession {
  let output = ''

  const proc = Bun.spawn(['bun', 'run', CLI_ENTRY, command, ...args], {
    cwd,
    env: {...process.env, HOME: cwd, ...env},
    terminal: {
      cols: 80,
      rows: 24,
      data(_terminal, data) {
        output += new TextDecoder().decode(data)
      },
    },
  })

  const term = proc.terminal!
  const getOutput = () => stripAnsi(output)

  function rawWaitForText(text: string, timeoutMs = TIMEOUT_MS): Promise<void> {
    return new Promise((resolve, reject) => {
      if (stripAnsi(output).includes(text)) {
        resolve()
        return
      }
      const interval = setInterval(() => {
        if (stripAnsi(output).includes(text)) {
          clearInterval(interval)
          clearTimeout(deadline)
          resolve()
        }
      }, 50)
      const deadline = setTimeout(() => {
        clearInterval(interval)
        reject(
          new Error(`Timed out waiting for "${text}" after ${timeoutMs}ms\n\nActual output:\n${stripAnsi(output)}`),
        )
      }, timeoutMs)
    })
  }

  function makeStep(base: Promise<void>): CliStep {
    const step = base as CliStep
    step.pressKey = (key) => {
      base.then(() => term.write(key))
      return step
    }
    step.pressEnter = () => {
      base.then(() => term.write(ENTER))
      return step
    }
    step.write = (text) => {
      base.then(() => term.write(text))
      return step
    }
    step.waitForText = (text, timeoutMs?) => makeStep(base.then(() => rawWaitForText(text, timeoutMs)))
    return step
  }

  const waitForText = (text: string, timeoutMs?: number): CliStep => makeStep(rawWaitForText(text, timeoutMs))

  const waitForExit = async (): Promise<CLIResult> => {
    const exitCode = await proc.exited
    return {output: stripAnsi(output), exitCode}
  }

  return {getOutput, waitForText, waitForExit}
}
