import {z} from 'zod'

import {spawnOwnedPipe} from '../e2e/framework/owned-pipe'
import {terminateTree} from '../e2e/framework/process'

/**
 * Pinned harness CLIs and the owned-process runner shared by the CI lanes that drive them (harness-smoke,
 * plugin-load-check). Both CLIs are exact npm versions run through bunx; callers point BUN_INSTALL_CACHE_DIR into
 * their sandbox, so local and CI runs fetch exactly these versions.
 */
export const CLAUDE_VERSION = '2.1.332'
export const DROID_VERSION = '1.20.0'
export const claudeCli = ['bunx', `@anthropic-ai/claude-code@${CLAUDE_VERSION}`]
export const droidCli = ['bunx', `droid@${DROID_VERSION}`]

const MAX_OUTPUT_BYTES = 2 * 1024 * 1024

export interface RunResult {
  code: number | null
  timedOut: boolean
  stdout: string
  stderr: string
  error?: string
}

async function drain(stream: ReadableStream<Uint8Array>, readers: ReadableStreamDefaultReader<Uint8Array>[]) {
  const reader = stream.getReader()
  readers.push(reader)
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const {done, value} = await reader.read()
    if (done) return Buffer.concat(chunks).toString('utf8')
    if (size + value.byteLength <= MAX_OUTPUT_BYTES) chunks.push(value)
    size += value.byteLength
  }
}

/** Owned process group (Job Object on Windows): a timeout or failure terminates every descendant. */
export async function run(
  command: string[],
  cwd: string,
  env: Record<string, string>,
  deadline: number,
  capMs: number,
): Promise<RunResult> {
  const timeoutMs = Math.min(capMs, deadline - performance.now())
  if (timeoutMs <= 0) return {code: null, timedOut: true, stdout: '', stderr: '', error: 'Deadline exceeded'}
  const readers: ReadableStreamDefaultReader<Uint8Array>[] = []
  const output = {stdout: '', stderr: ''}
  let child: Awaited<ReturnType<typeof spawnOwnedPipe>> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let code: number | null = null
  let timedOut = false
  const errors: string[] = []
  try {
    child = await spawnOwnedPipe(command, cwd, env)
    const started = child
    await Promise.race([
      Promise.all([
        drain(started.stdout, readers).then((text) => (output.stdout = text)),
        drain(started.stderr, readers).then((text) => (output.stderr = text)),
        started.exited.then((exit) => (code = exit)),
      ]),
      new Promise<void>((done) => {
        timer = setTimeout(() => {
          timedOut = true
          done()
        }, timeoutMs)
      }),
    ])
  } catch (error) {
    errors.push(String(error))
  } finally {
    clearTimeout(timer)
    try {
      if (child) await terminateTree(child, env)
    } catch (error) {
      errors.push(`Cleanup failed: ${String(error)}`)
    }
    await Promise.allSettled(readers.map((reader) => reader.cancel()))
  }
  return {
    code: timedOut ? null : code,
    timedOut,
    ...output,
    ...(errors.length ? {error: errors.join('; ')} : {}),
  }
}

export const diagnostic = (result: RunResult, chars = 800): string =>
  [result.timedOut ? 'timed out' : `exit ${result.code}`, result.error, result.stdout, result.stderr]
    .filter(Boolean)
    .join('\n')
    .trim()
    .slice(-chars)

/** The process exited on its own, within its deadline, and its process tree was cleaned up; any exit code. */
export const completed = (result: RunResult) => !result.timedOut && !result.error && result.code !== null

export const succeeded = (result: RunResult) => completed(result) && result.code === 0

export function parseEvents(stdout: string): unknown[] {
  return stdout.split('\n').flatMap((line) => {
    try {
      return [JSON.parse(line) as unknown]
    } catch {
      return []
    }
  })
}

const resultEvent = z.object({
  type: z.literal('result'),
  total_cost_usd: z.number(),
  duration_api_ms: z.number(),
  modelUsage: z.record(z.string(), z.unknown()),
})
const assistantEvent = z.object({type: z.literal('assistant'), message: z.object({model: z.string()})})

/**
 * Without credentials `claude -p` stops at a synthetic "Not logged in" reply; zero cost, zero API time, no model
 * usage and only synthetic assistant messages prove that no model call happened.
 */
export function claudeMadeNoModelCall(events: unknown[]): {ok: boolean; detail: string} {
  const result = events.map((event) => resultEvent.safeParse(event)).find((parsed) => parsed.success)?.data
  const models = events.flatMap((event) => {
    const parsed = assistantEvent.safeParse(event)
    return parsed.success ? [parsed.data.message.model] : []
  })
  return {
    ok:
      result !== undefined &&
      result.total_cost_usd === 0 &&
      result.duration_api_ms === 0 &&
      Object.keys(result.modelUsage).length === 0 &&
      models.every((model) => model === '<synthetic>'),
    detail: `result: ${JSON.stringify(result ?? null)}; assistant models: ${models.join(',') || '(none)'}`,
  }
}
