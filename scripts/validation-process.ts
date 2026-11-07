import stripAnsi from 'strip-ansi'

import type {PipeProcess} from '../e2e/framework/owned-pipe'
import {spawnOwnedPipe} from '../e2e/framework/owned-pipe'
import {
  createTranscript,
  diagnosticHead,
  diagnosticJSON,
  drainTranscript,
  terminateTree,
} from '../e2e/framework/process'
import {redact, redactData} from '../src/domain/redact'
import type {TestSandbox} from './test-sandbox'
import {createTestSandbox} from './test-sandbox'
import {MAX_EVIDENCE_BYTES} from './validation-evidence'
import {repositoryRoot} from './validation-identity'

export interface CommandOutcome {
  signal: string | null
  cwd: string
  seed: string | null
  replay: string | null
  exit_code: number | null
  duration_ms: number
  timed_out: boolean
  stdout: string
  stderr: string
  reason?: string
}

/** Recognize complete private input before reserving a bounded lane-schema-safe primary summary. */
export function commandReason(value: string): string {
  return (
    diagnosticHead(stripAnsi(redact(value)).replaceAll(repositoryRoot, '<repository>'), 16000) ||
    'Validation unavailable'
  )
}

/** Sanitize fields before JSON; budget escaped strings within both evidence consumers' cap. */
export function commandLog(command: readonly string[], result: CommandOutcome): string {
  const data = redactData({command: [...command], ...result})
  data.command = data.command.map((part) => diagnosticJSON(part, 1024))
  data.cwd = diagnosticJSON(data.cwd, 1024)
  if (data.signal !== null) data.signal = diagnosticJSON(data.signal, 1024)
  data.stdout = diagnosticJSON(data.stdout, MAX_EVIDENCE_BYTES / 4, true)
  data.stderr = diagnosticJSON(data.stderr, MAX_EVIDENCE_BYTES / 4, true)
  for (const key of ['seed', 'replay'] as const)
    if (data[key] !== null) data[key] = diagnosticJSON(data[key], MAX_EVIDENCE_BYTES / 8)
  if (data.reason) data.reason = commandReason(data.reason)
  return JSON.stringify(data)
}

/** Snapshot only allowlisted replay inputs, before setup or cleanup can change them. */
export function commandMetadata() {
  const safe = (value: string | undefined) => {
    if (value === undefined) return null
    const transcript = createTranscript(redact)
    transcript.append(Buffer.from(value))
    transcript.finish()
    return transcript.visibleDiagnostic()
  }
  return {signal: null as string | null, cwd: '.', seed: safe(process.env.FC_SEED), replay: safe(process.env.FC_PATH)}
}

/** Bounded diagnostics, closed stdin, isolated HOME/cache and owned process group. */
export async function executeCheck(
  command: string[],
  timeoutMs: number,
  ports = {createSandbox: createTestSandbox, spawn: spawnOwnedPipe, terminate: terminateTree},
): Promise<CommandOutcome> {
  const start = performance.now()
  const metadata = commandMetadata()
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
      repositoryRoot,
      sandbox.env,
    )
    await Promise.race([
      Promise.all([
        drainTranscript(child.stdout, stdout, readers),
        drainTranscript(child.stderr, stderr, readers),
        child.exited.then((code) => {
          if (observing) {
            exit = code
            metadata.signal = child?.signalCode ? String(child.signalCode) : null
          }
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
    const text = stripAnsi(redact(value)).replaceAll(repositoryRoot, '<repository>')
    return sandbox ? text.replaceAll(sandbox.root, '<sandbox>') : text
  }
  return {
    ...metadata,
    exit_code: exit !== null && exit !== 0 ? exit : timedOut ? null : exit,
    duration_ms: performance.now() - start,
    timed_out: timedOut,
    stdout: clean(stdout.visibleDiagnostic()),
    stderr: clean(stderr.visibleDiagnostic()),
    ...(reason ? {reason: commandReason(clean(reason))} : {}),
  }
}
