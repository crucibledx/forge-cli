import stripAnsi from 'strip-ansi'

import type {PipeProcess} from '../e2e/framework/owned-pipe'
import {spawnOwnedPipe} from '../e2e/framework/owned-pipe'
import {createTranscript, drainTranscript, terminateTree} from '../e2e/framework/process'
import {redact} from '../src/domain/redact'
import type {TestSandbox} from './test-sandbox'
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
export async function executeCheck(
  command: string[],
  cwd: string,
  timeoutMs: number,
  ports = {createSandbox: createTestSandbox, spawn: spawnOwnedPipe, terminate: terminateTree},
): Promise<CommandOutcome> {
  const start = performance.now()
  let sandbox: TestSandbox | undefined
  const stdout = createTranscript(redact),
    stderr = createTranscript(redact)
  const readers: ReadableStreamDefaultReader<Uint8Array>[] = []
  let child: PipeProcess | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let timedOut = false
  let exit: number | null = null
  let observing = true
  let reason: string | undefined
  const cleanupFailed = (error: unknown) => {
    if (exit === 0) exit = null
    reason = [reason, `Cleanup failed: ${String(error)}`].filter(Boolean).join('; ')
  }
  try {
    sandbox = ports.createSandbox('forge-validation-', undefined, Math.min(30000, Math.max(1, timeoutMs)))
    if (performance.now() - start >= timeoutMs) {
      timedOut = true
      throw new Error('Command deadline exceeded during sandbox setup')
    }
    child = await ports.spawn(
      [command[0] === 'bun' ? process.execPath : command[0], ...command.slice(1)],
      cwd,
      sandbox.env,
    )
    await Promise.race([
      Promise.all([
        drainTranscript(child.stdout, stdout, readers),
        drainTranscript(child.stderr, stderr, readers),
        child.exited.then((code) => {
          if (observing) exit = code
        }),
      ]),
      new Promise<void>((resolve) => {
        timer = setTimeout(
          () => {
            timedOut = true
            observing = false
            reason = 'Command deadline exceeded'
            resolve()
          },
          Math.max(1, timeoutMs - (performance.now() - start)),
        )
      }),
    ])
  } catch (error) {
    if (exit === 0) exit = null
    reason = error instanceof Error ? error.message : String(error)
  } finally {
    observing = false
    clearTimeout(timer)
    try {
      if (child) await ports.terminate(child)
    } catch (error) {
      cleanupFailed(error)
    }
    await Promise.allSettled(readers.map((reader) => reader.cancel()))
    try {
      sandbox?.dispose()
    } catch (error) {
      cleanupFailed(error)
    }
  }
  const clean = (value: string) => {
    const text = redact(stripAnsi(value)).replaceAll(cwd, '<repository>')
    return sandbox ? text.replaceAll(sandbox.root, '<sandbox>') : text
  }
  return {
    exit_code: exit !== null && exit !== 0 ? exit : timedOut ? null : exit,
    duration_ms: performance.now() - start,
    timed_out: timedOut,
    stdout: clean(stdout.visibleDiagnostic()),
    stderr: clean(stderr.visibleDiagnostic()),
    ...(reason ? {reason: clean(reason)} : {}),
  }
}
