import './teardown'

import {testEnvironment} from '../../scripts/test-sandbox'
import {sessionFailure} from './failure'
import {spawnOwnedPipe} from './owned-pipe'
import {
  createTranscript,
  diagnosticTail,
  drainTranscript,
  ownSession,
  sanitize,
  sessionBudget,
  TAIL_BYTES,
  terminateTree,
} from './process'
import type {CLIResult} from './spawn'

export interface ProcessOptions {
  timeoutMs?: number
  env?: Record<string, string>
  secrets?: string[]
  /** Inspect bounded fixture output before diagnostic redaction, never publish it. */
  inspectRaw?: (stdout: string, stderr: string) => void
}

export async function runPipe(cwd: string, command: string[], options: ProcessOptions = {}): Promise<CLIResult> {
  const budget = sessionBudget(options.timeoutMs)
  const started = performance.now()
  const env = testEnvironment(cwd, options.env)
  const proc = await spawnOwnedPipe(command, cwd, env)
  const clean = (text: string) => sanitize(text, cwd, options.secrets)
  const stdout = createTranscript(clean, options.secrets)
  const stderr = createTranscript(clean, options.secrets)
  let timedOut = false
  const readers: ReadableStreamDefaultReader<Uint8Array>[] = []
  // Start both reads before waiting for exit, including on nonzero exits.
  const drains = Promise.all([
    drainTranscript(proc.stdout, stdout, readers),
    drainTranscript(proc.stderr, stderr, readers),
  ])
  void drains.catch(() => {})
  const owner = ownSession(async () => {
    clearTimeout(deadline)
    try {
      await terminateTree(proc, env)
    } finally {
      await Promise.allSettled(readers.map((reader) => reader.cancel()))
    }
  })
  const deadline = setTimeout(
    () => {
      timedOut = true
      void owner.dispose().catch(() => {})
    },
    Math.max(1, budget - (performance.now() - started)),
  )
  const errors: unknown[] = []
  try {
    await Promise.race([proc.exited, owner.finished])
    // A descendant may hold pipes open; the total deadline still owns the drain.
    await Promise.race([drains, owner.finished])
    options.inspectRaw?.(stdout.rawText(), stderr.rawText())
  } catch (error) {
    errors.push(error)
  } finally {
    try {
      await owner.dispose()
    } catch (error) {
      if (!errors.includes(error)) errors.push(error)
    }
  }
  const result = {
    stdout: stdout.diagnostic(),
    stderr: stderr.diagnostic(),
    output: stdout.visibleDiagnostic(),
    exitCode: proc.signalCode ? null : proc.exitCode,
    signal: proc.signalCode ? String(proc.signalCode) : null,
    timedOut,
  }
  if (errors.length)
    throw sessionFailure(
      errors,
      {
        command,
        cwd,
        exit: result.exitCode,
        signal: result.signal,
        timedOut,
        timeoutMs: budget,
        seed: env.FC_SEED ?? null,
        replay: env.FC_PATH ?? null,
      },
      `stdout:\n${diagnosticTail(stdout.visibleDiagnostic(), TAIL_BYTES / 8)}\nstderr:\n${diagnosticTail(stderr.visibleDiagnostic(), TAIL_BYTES / 8)}`,
      options.secrets,
    )
  return result
}
