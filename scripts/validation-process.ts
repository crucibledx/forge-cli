import {existsSync, realpathSync} from 'node:fs'

import stripAnsi from 'strip-ansi'

import type {PipeProcess} from '../e2e/framework/owned-pipe'
import {spawnOwnedPipe} from '../e2e/framework/owned-pipe'
import {createTranscript, diagnosticHead, drainTranscript, terminateTree} from '../e2e/framework/process'
import {redact} from '../src/domain/redact'
import {repositoryRoot} from './repository-root'
import type {TestSandbox} from './test-sandbox'
import {createTestSandbox} from './test-sandbox'

export const MAX_STRUCTURED_BYTES = 2 * 1024 * 1024

export interface CommandOutcome {
  exit_code: number | null
  timed_out: boolean
  stdout: string
  stderr: string
  reason?: string
}

/** Private, bounded protocol input. Consumers must validate and sanitize it before publishing. */
export interface StructuredCommandOutput {
  data?: unknown
}

/** Replace known roots even when a native child expands short paths or prints escaped separators. */
function privatePath(text: string, root: string, label: string, aliases = false): string {
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const flags = process.platform === 'win32' || /^[a-z]:[\\/]/i.test(root) ? 'gi' : 'g'
  const variants = [root, root.replaceAll('\\', '/'), root.replaceAll('/', '\\')]
  for (const value of new Set(variants.flatMap((value) => [value, JSON.stringify(value).slice(1, -1)])))
    text = text.replace(new RegExp(escape(value), flags), label)
  if (aliases && /^[a-z]:[\\/]/i.test(root)) {
    // The random per-command leaf binds this to our private root, not arbitrary
    // public paths. No filesystem lookup is possible after sandbox disposal.
    const leaf = root.split(/[\\/]/).at(-1)!
    text = text.replace(
      new RegExp(String.raw`[a-z]:[\\/]+[^:\r\n"]*?[\\/]+${escape(leaf)}(?=[\\/\s"']|$)`, 'gi'),
      label,
    )
  }
  return text
}

/** Recognize complete private input before reserving a bounded primary summary. */
function commandReason(value: string): string {
  return (
    diagnosticHead(privatePath(stripAnsi(redact(value)), repositoryRoot, '<repository>'), 16000) ||
    'Validation unavailable'
  )
}

/** Bounded diagnostics, closed stdin, isolated HOME/cache and owned process group. */
export async function executeCheck(
  command: string[],
  timeoutMs: number,
  ports = {createSandbox: createTestSandbox, spawn: spawnOwnedPipe, terminate: terminateTree},
  structured?: StructuredCommandOutput,
): Promise<CommandOutcome> {
  const start = performance.now()
  let sandbox: TestSandbox | undefined
  const privateRoots = new Set<string>()
  const stdout = createTranscript(redact),
    stderr = createTranscript(redact)
  const readers: ReadableStreamDefaultReader<Uint8Array>[] = []
  let child: PipeProcess | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let timedOut = false
  let exit: number | null = null
  let observing = true
  let reason: string | undefined
  const structuredBuffer = structured ? Buffer.alloc(MAX_STRUCTURED_BYTES) : undefined
  let structuredBytes = 0
  if (structured) delete structured.data
  const cleanupFailed = (error: unknown) => {
    if (exit === 0) exit = null
    reason = [reason, `Cleanup failed: ${String(error)}`].filter(Boolean).join('; ')
  }
  try {
    sandbox = ports.createSandbox('forge-validation-', undefined, Math.min(30000, Math.max(1, timeoutMs)))
    privateRoots.add(sandbox.root)
    if (existsSync(sandbox.root)) privateRoots.add(realpathSync(sandbox.root))
    if (performance.now() - start >= timeoutMs) {
      timedOut = true
      throw new Error('Command deadline exceeded during sandbox setup')
    }
    child = await ports.spawn(
      command[0] === 'bun' || command[0] === process.execPath
        ? [process.execPath, '--no-env-file', ...command.slice(1)]
        : command,
      repositoryRoot,
      sandbox.env,
    )
    const stdoutStream = structured
      ? child.stdout.pipeThrough(
          new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, controller) {
              if (structuredBytes <= MAX_STRUCTURED_BYTES) {
                if (chunk.byteLength <= MAX_STRUCTURED_BYTES - structuredBytes)
                  structuredBuffer!.set(chunk, structuredBytes)
                structuredBytes = Math.min(MAX_STRUCTURED_BYTES + 1, structuredBytes + chunk.byteLength)
              }
              controller.enqueue(chunk)
            },
          }),
        )
      : child.stdout
    await Promise.race([
      Promise.all([
        drainTranscript(stdoutStream, stdout, readers),
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
      if (child) await ports.terminate(child, sandbox!.env)
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
  if (structured && structuredBytes <= MAX_STRUCTURED_BYTES) {
    try {
      structured.data = JSON.parse(
        new TextDecoder('utf-8', {fatal: true}).decode(structuredBuffer!.subarray(0, structuredBytes)),
      )
    } catch {
      // Invalid/incomplete/oversized protocol input must not become a clean result.
    }
  }
  const clean = (value: string) => {
    let text = stripAnsi(redact(value))
    for (const root of [...privateRoots].sort((a, b) => b.length - a.length))
      text = privatePath(text, root, '<sandbox>', true)
    return privatePath(text, repositoryRoot, '<repository>')
  }
  return {
    exit_code: exit !== null && exit !== 0 ? exit : timedOut ? null : exit,
    timed_out: timedOut,
    stdout: clean(stdout.visibleDiagnostic()),
    stderr: clean(stderr.visibleDiagnostic()),
    ...(reason ? {reason: commandReason(clean(reason))} : {}),
  }
}
