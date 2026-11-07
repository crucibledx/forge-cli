import './teardown'

import {testEnvironment} from '../../scripts/test-sandbox'
import {CLI_ENTRY} from './constants'
import {sessionFailure} from './failure'
import {ENTER} from './keys'
import type {ProcessOptions} from './pipe'
import {posixOwnership} from './posix-owner'
import {createTranscript, ownSession, sanitize, sessionBudget, terminateTree} from './process'

export interface CLIResult {
  stdout: string
  stderr: string
  output: string
  exitCode: number | null
  signal: string | null
  timedOut: boolean
}

export interface CliStep extends Promise<void> {
  pressKey(key: string): CliStep
  pressEnter(): CliStep
  write(text: string): CliStep
  waitForText(text: string, timeoutMs?: number, mark?: number): CliStep
}

export interface CLISession {
  /** One absolute total deadline, shared with the convenience runner's driver. */
  deadlineAt: number
  /** Bounded combined PTY transcript, not a terminal screen or separate streams. */
  getOutput(): string
  failure(errors: readonly unknown[]): Error
  mark(): number
  waitForText(text: string, timeoutMs?: number, mark?: number): CliStep
  waitForExit(): Promise<CLIResult>
  dispose(): Promise<void>
}

export function spawnPty(cwd: string, command: string[], options: ProcessOptions = {}): CLISession {
  if (process.platform === 'win32') throw new Error('PTY journeys require a native POSIX runner')
  const budget = sessionBudget(options.timeoutMs)
  const replay = {
    seed: options.env?.FC_SEED ?? process.env.FC_SEED ?? null,
    replay: options.env?.FC_PATH ?? process.env.FC_PATH ?? null,
  }
  const transcript = createTranscript((text) => sanitize(text, cwd, options.secrets), options.secrets)
  const listeners = new Set<() => void>()
  let cursor = 0
  let exited = false
  let closed = false
  let timedOut = false
  const notify = () => listeners.forEach((listener) => listener())
  const ownership = posixOwnership(command)
  const env = testEnvironment(cwd, {TERM: 'xterm-256color', ...options.env})
  const proc = ownership.wrap(
    Bun.spawn(ownership.command, {
      cwd,
      env,
      detached: true,
      ipc: ownership.ipc,
      terminal: {
        cols: 80,
        rows: 24,
        data(_terminal, bytes) {
          transcript.append(bytes)
          notify()
        },
      },
    }),
  )
  const term = proc.terminal!
  const getOutput = () => transcript.visibleDiagnostic()
  const failure = (errors: readonly unknown[]) =>
    sessionFailure(
      errors,
      {
        command,
        cwd,
        exit: proc.signalCode ? null : proc.exitCode,
        signal: proc.signalCode ? String(proc.signalCode) : null,
        timedOut,
        timeoutMs: budget,
        ...replay,
      },
      getOutput(),
      options.secrets,
    )
  const mark = () => transcript.offset + transcript.text().length
  const owner = ownSession(async () => {
    closed = true
    clearTimeout(deadline)
    notify()
    try {
      await terminateTree(proc, env)
    } finally {
      term.close()
    }
  })
  const deadlineAt = performance.now() + budget
  const deadline = setTimeout(
    () => {
      timedOut = true
      notify()
      void owner.dispose().catch(() => {})
    },
    Math.max(0, deadlineAt - performance.now()),
  )
  const exit = proc.exited.then(() => {
    exited = true
    transcript.finish()
    notify()
  })

  function wait(text: string, timeoutMs?: number, from = cursor): Promise<void> {
    if (!text || !Number.isInteger(from) || from < 0 || from > mark()) {
      return Promise.reject(new Error('Expected nonempty text and a valid transcript mark'))
    }
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      const finish = (error?: Error) => {
        clearTimeout(timer)
        listeners.delete(check)
        if (error) reject(error)
        else resolve()
      }
      const check = () => {
        const offset = transcript.offset
        const index = transcript.text().indexOf(text, Math.max(0, from - offset))
        if (index >= 0) {
          cursor = Math.max(cursor, offset + index + text.length)
          finish()
        } else if (exited || closed || timedOut) {
          finish(failure([new Error(`PTY ${timedOut ? 'deadline expired' : 'exited/closed'} waiting for "${text}"`)]))
        }
      }
      listeners.add(check)
      if (timeoutMs !== undefined) {
        timer = setTimeout(
          () => finish(failure([new Error(`PTY wait expired for "${text}"`)])),
          sessionBudget(timeoutMs),
        )
      }
      check()
    })
  }

  function write(text: string): Promise<void> {
    return Promise.resolve().then(() => {
      if (closed || exited || timedOut) throw new Error('Cannot write to a closed PTY session')
      term.write(text)
    })
  }

  function step(base: Promise<void>): CliStep {
    const result = base as CliStep
    result.pressKey = (key) => step(base.then(() => write(key)))
    result.pressEnter = () => result.pressKey(ENTER)
    result.write = (text) => step(base.then(() => write(text)))
    result.waitForText = (text, timeoutMs, from) => step(base.then(() => wait(text, timeoutMs, from)))
    return result
  }

  return {
    deadlineAt,
    getOutput,
    failure,
    mark,
    waitForText: (text, timeoutMs, from) => step(wait(text, timeoutMs, from)),
    dispose: owner.dispose,
    async waitForExit() {
      try {
        await Promise.race([exit, owner.finished])
        return {
          output: getOutput(),
          stdout: '',
          stderr: '',
          exitCode: proc.signalCode ? null : proc.exitCode,
          signal: proc.signalCode ? String(proc.signalCode) : null,
          timedOut,
        }
      } finally {
        await owner.dispose()
      }
    },
  }
}

export function spawnInteractive(
  cwd: string,
  command: string,
  args: string[] = [],
  env: Record<string, string> = {},
): CLISession {
  return spawnPty(cwd, [process.execPath, 'run', CLI_ENTRY, command, ...args], {env})
}
