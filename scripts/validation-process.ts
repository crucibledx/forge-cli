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
  const stdout = createTranscript(),
    stderr = createTranscript()
  const readers: ReadableStreamDefaultReader<Uint8Array>[] = []
  let child: Bun.Subprocess<'ignore', 'pipe', 'pipe'> | undefined
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
    child = Bun.spawn([command[0] === 'bun' ? process.execPath : command[0], ...command.slice(1)], {
      cwd,
      env: sandbox.env,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
      detached: process.platform !== 'win32',
    })
    await Promise.race([
      Promise.all([drain(child.stdout, stdout), drain(child.stderr, stderr), child.exited]).then((results) => {
        exit = results[2]
      }),
      new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          timedOut = true
          reason = 'Command deadline exceeded'
          resolve()
        }, timeoutMs)
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
    stdout: clean(stdout.text()),
    stderr: clean(stderr.text()),
    ...(reason ? {reason: clean(reason)} : {}),
  }
}
