import stripAnsi from 'strip-ansi'

import type {PipeProcess} from '../e2e/framework/owned-pipe'
import {spawnOwnedPipe} from '../e2e/framework/owned-pipe'
import {createTranscript, terminateTree} from '../e2e/framework/process'
import {redact} from '../src/domain/redact'
import {createTestSandbox} from './test-sandbox'

export interface CommandOutcome {
  exit_code: number | null
  duration_ms: number
  timed_out: boolean
  stdout: string
  stderr: string
  reason?: string
}

/** Bounded diagnostics, closed stdin, isolated HOME/cache and owned process group. */
export async function executeCheck(command: string[], cwd: string, timeoutMs: number): Promise<CommandOutcome> {
  const start = performance.now()
  const sandbox = createTestSandbox('forge-validation-')
  const stdout = createTranscript(redact),
    stderr = createTranscript(redact)
  const readers: ReadableStreamDefaultReader<Uint8Array>[] = []
  let child: PipeProcess | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let timedOut = false
  let exit: number | null = null
  let reason: string | undefined
  const drain = async (stream: ReadableStream<Uint8Array>, tail: ReturnType<typeof createTranscript>) => {
    const reader = stream.getReader()
    readers.push(reader)
    try {
      while (true) {
        const {done, value} = await reader.read()
        if (done) break
        tail.append(value)
      }
      tail.finish()
    } finally {
      reader.releaseLock()
    }
  }
  try {
    child = await spawnOwnedPipe(
      [command[0] === 'bun' ? process.execPath : command[0], ...command.slice(1)],
      cwd,
      sandbox.env,
    )
    await Promise.race([
      Promise.all([drain(child.stdout, stdout), drain(child.stderr, stderr), child.exited]).then((results) => {
        exit = results[2]
      }),
      new Promise<void>((resolve) => {
        timer = setTimeout(
          () => {
            timedOut = true
            reason = 'Command deadline exceeded'
            resolve()
          },
          Math.max(1, timeoutMs - (performance.now() - start)),
        )
      }),
    ])
  } catch (error) {
    reason = error instanceof Error ? error.message : String(error)
  } finally {
    clearTimeout(timer)
    try {
      if (child) await terminateTree(child)
    } catch (error) {
      exit = null
      reason = `Cleanup failed: ${String(error)}`
    }
    await Promise.allSettled(readers.map((reader) => reader.cancel()))
    sandbox.dispose()
  }
  const clean = (value: string) => redact(value).replaceAll(sandbox.root, '<sandbox>').replaceAll(cwd, '<repository>')
  return {
    exit_code: timedOut ? null : exit,
    duration_ms: performance.now() - start,
    timed_out: timedOut,
    stdout: clean(stripAnsi(stdout.diagnostic())),
    stderr: clean(stripAnsi(stderr.diagnostic())),
    ...(reason ? {reason: clean(reason)} : {}),
  }
}
