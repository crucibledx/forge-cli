import './teardown'

import stripAnsi from 'strip-ansi'

import {testEnvironment} from '../../scripts/test-sandbox'
import {spawnOwnedPipe} from './owned-pipe'
import {activeProcesses, createTranscript, drainTranscript, sanitize, sessionBudget, terminateTree} from './process'
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
  const proc = await spawnOwnedPipe(command, cwd, testEnvironment(cwd, options.env))
  const clean = (text: string) => sanitize(text, cwd, options.secrets)
  const stdout = createTranscript(clean, options.secrets)
  const stderr = createTranscript(clean, options.secrets)
  let timedOut = false
  let disposal: Promise<void> | undefined
  const readers: ReadableStreamDefaultReader<Uint8Array>[] = []
  // Start both reads before waiting for exit, including on nonzero exits.
  const drains = Promise.all([
    drainTranscript(proc.stdout, stdout, readers),
    drainTranscript(proc.stderr, stderr, readers),
  ])
  void drains.catch(() => {})
  const owner = {
    dispose() {
      return (disposal ??= (async () => {
        clearTimeout(deadline)
        try {
          await terminateTree(proc)
        } finally {
          await Promise.allSettled(readers.map((reader) => reader.cancel()))
          activeProcesses.delete(owner)
        }
      })())
    },
  }
  activeProcesses.add(owner)
  const deadline = setTimeout(
    () => {
      timedOut = true
      void owner.dispose().catch(() => {})
    },
    Math.max(1, budget - (performance.now() - started)),
  )
  try {
    await proc.exited
    // A descendant may hold pipes open; the total deadline still owns the drain.
    await drains
    options.inspectRaw?.(stdout.rawText(), stderr.rawText())
    return {
      stdout: stdout.diagnostic(),
      stderr: stderr.diagnostic(),
      output: stripAnsi(stdout.diagnostic()),
      exitCode: proc.signalCode ? null : proc.exitCode,
      signal: proc.signalCode ? String(proc.signalCode) : null,
      timedOut,
    }
  } finally {
    await owner.dispose()
  }
}
