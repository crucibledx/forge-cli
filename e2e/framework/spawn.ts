import './teardown'

import {testEnvironment} from '../../scripts/test-sandbox'
import {CLI_ENTRY} from './constants'
import {ENTER} from './keys'
import type {ProcessOptions} from './pipe'
import {activeProcesses, createTranscript, sanitize, sessionBudget, terminateTree} from './process'

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
  /** Bounded combined PTY transcript, not a terminal screen or separate streams. */
  getOutput(): string
  mark(): number
  waitForText(text: string, timeoutMs?: number, mark?: number): CliStep
  waitForExit(): Promise<CLIResult>
  dispose(): Promise<void>
}

export function spawnPty(cwd: string, command: string[], options: ProcessOptions = {}): CLISession {
  if (process.platform === 'win32') throw new Error('PTY journeys require a native POSIX runner')
  const budget = sessionBudget(options.timeoutMs)
  const transcript = createTranscript()
  const listeners = new Set<() => void>()
  let cursor = 0
  let exited = false
  let closed = false
  let timedOut = false
  let disposal: Promise<void> | undefined
  const notify = () => listeners.forEach((listener) => listener())
  const proc = Bun.spawn(command, {
    cwd,
    env: testEnvironment(cwd, {TERM: 'xterm-256color', ...options.env}),
    detached: true,
    terminal: {
      cols: 80,
      rows: 24,
      data(_terminal, bytes) {
        transcript.append(bytes)
        notify()
      },
    },
  })
  const term = proc.terminal!
  const getOutput = () => sanitize(transcript.text(), cwd, options.secrets)
  const mark = () => transcript.offset + transcript.text().length
  const owner = {
    dispose() {
      return (disposal ??= (async () => {
        closed = true
        clearTimeout(deadline)
        notify()
        try {
          await terminateTree(proc)
        } finally {
          term.close()
          activeProcesses.delete(owner)
        }
      })())
    },
  }
  activeProcesses.add(owner)
  const deadline = setTimeout(() => {
    timedOut = true
    notify()
    void owner.dispose().catch(() => {})
  }, budget)
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
          cursor = offset + index + text.length
          finish()
        } else if (exited || closed || timedOut) {
          finish(
            new Error(
              sanitize(
                `PTY ${timedOut ? 'deadline expired' : 'exited/closed'} waiting for ${JSON.stringify(text.slice(0, 200))}\n${getOutput()}`,
                cwd,
                options.secrets,
              ),
            ),
          )
        }
      }
      listeners.add(check)
      if (timeoutMs !== undefined) {
        timer = setTimeout(
          () =>
            finish(
              new Error(
                sanitize(
                  `PTY wait expired for ${JSON.stringify(text.slice(0, 200))}\n${getOutput()}`,
                  cwd,
                  options.secrets,
                ),
              ),
            ),
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
    getOutput,
    mark,
    waitForText: (text, timeoutMs, from) => step(wait(text, timeoutMs, from)),
    dispose: owner.dispose,
    async waitForExit() {
      try {
        await exit
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
