import {redact, redactionContext} from '../../src/domain/redact'
import {createAnsiText} from './ansi-text'
import {windowsJobs} from './windows-job'
export const SESSION_MS = 10_000
export const TAIL_BYTES = 256 * 1024
export const activeProcesses = new Set<{dispose(): Promise<void>}>()

export function sessionBudget(timeoutMs = SESSION_MS): number {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new Error('Session timeout must be between 1 and 30000 ms')
  }
  return timeoutMs
}

export function sanitize(text: string, cwd: string, secrets: string[] = []): string {
  // Domain redaction owns URI credentials; harness scrubbing additionally covers
  // disposable paths, explicit fixture secrets and loose assignment-shaped text.
  for (const secret of secrets.filter(Boolean)) text = text.replaceAll(secret, '[redacted]')
  return redact(text)
    .replace(/((?:token|password|secret|authorization)[=:]\s*)[^\s&]+/gi, '$1[redacted]')
    .replaceAll(cwd, '<project>')
}

export function createTranscript(clean: (text: string) => string = (text) => text, secrets: string[] = []) {
  const decoder = new TextDecoder()
  const plainText = createAnsiText()
  let raw = ''
  let plain = ''
  let offset = 0
  let context = ''
  let secretPrefix = ''
  let diagnostic = ''
  const tail = (text: string) => {
    const bytes = Buffer.from(text)
    let start = Math.max(0, bytes.length - TAIL_BYTES)
    while ((bytes[start] & 0xc0) === 0x80) start++
    return bytes.subarray(start).toString()
  }
  function add(text: string): void {
    const visible = plain + plainText(text)
    plain = tail(visible)
    offset += visible.length - plain.length
    raw += text
    // Redact with the original recognizer context BEFORE discarding bytes.
    // Explicit-secret recognition and credential syntax advance independently.
    // Mask a known continuation before adding synthetic credential context.
    let hidden = 0
    for (const secret of secrets) {
      for (let size = Math.min(secret.length - 1, secretPrefix.length); size > 0; size--) {
        if (!secretPrefix.endsWith(secret.slice(0, size))) continue
        const rest = secret.slice(size)
        if (raw.startsWith(rest)) hidden = Math.max(hidden, rest.length)
        else if (rest.startsWith(raw)) hidden = Math.max(hidden, raw.length)
      }
    }
    diagnostic = tail(clean(context + (hidden ? '[redacted]' + raw.slice(hidden) : raw)))
    const bytes = Buffer.from(raw)
    if (bytes.length > TAIL_BYTES) {
      let start = bytes.length - TAIL_BYTES
      while ((bytes[start] & 0xc0) === 0x80) start++
      const discarded = bytes.subarray(0, start).toString()
      context = redactionContext(context + discarded)
      const prefix = secretPrefix + discarded
      secretPrefix = ''
      for (const secret of secrets) {
        for (let size = Math.min(secret.length - 1, prefix.length); size > secretPrefix.length; size--) {
          if (prefix.endsWith(secret.slice(0, size))) {
            secretPrefix = secret.slice(0, size)
            break
          }
        }
      }
      raw = bytes.subarray(start).toString()
    }
  }

  return {
    get offset() {
      return offset
    },
    append(bytes: Uint8Array) {
      add(decoder.decode(bytes, {stream: true}))
    },
    finish() {
      add(decoder.decode())
    },
    text() {
      return plain
    },
    rawText() {
      return raw
    },
    diagnostic() {
      return diagnostic
    },
  }
}

export async function drainTranscript(
  stream: ReadableStream<Uint8Array>,
  tail: ReturnType<typeof createTranscript>,
  readers: ReadableStreamDefaultReader<Uint8Array>[],
): Promise<void> {
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

export type OwnedProcess = Pick<Bun.Subprocess, 'pid' | 'exited' | 'kill' | 'exitCode' | 'signalCode'>

function groupAlive(pid: number): boolean {
  // On macOS, signal-zero may return EPERM for an orphan already awaiting init's
  // reap. Zombies have no running code or open descriptors, but are still PIDs.
  const result = Bun.spawnSync(['ps', '-axo', 'pgid=,stat='], {stdout: 'pipe', stderr: 'pipe'})
  if (result.exitCode !== 0) throw new Error('Cannot verify owned process-group cleanup')
  return new TextDecoder()
    .decode(result.stdout)
    .split('\n')
    .some((line) => {
      const [group, state] = line.trim().split(/\s+/)
      return Number(group) === pid && !state.startsWith('Z')
    })
}

/** Process-group ownership on POSIX; an owned process tree on Windows. */
export async function terminateTree(proc: OwnedProcess): Promise<void> {
  if (process.platform === 'win32') {
    const job = windowsJobs.get(proc.pid)
    if (!job) throw new Error('Windows process has no durable job ownership')
    const end = performance.now() + 2000
    try {
      if (job.active()) {
        if (proc.exitCode === null) proc.kill('SIGTERM')
        await new Promise((resolve) => setTimeout(resolve, 500))
        job.terminate()
      }
      while (job.active()) {
        if (performance.now() >= end) throw new Error('Owned Windows descendants survived cleanup budget')
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([
          proc.exited,
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error('Windows leader failed to reap')),
              Math.max(1, end - performance.now()),
            )
          }),
        ])
      } finally {
        clearTimeout(timer)
      }
    } finally {
      windowsJobs.delete(proc.pid)
      job.close()
    }
    return
  }
  const signal = (value: NodeJS.Signals | 0) => {
    try {
      process.kill(-proc.pid, value)
      return true
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      // The durable owner can finish first. Ignore EPERM only after proving
      // that the group contains no live process, never for a real denial.
      if (code === 'ESRCH' || (code === 'EPERM' && !groupAlive(proc.pid))) return false
      throw error
    }
  }
  if (!signal(0)) {
    await proc.exited
    return
  }
  signal('SIGTERM')
  // Always escalate the group, even if its leader exited before its descendants.
  await new Promise((resolve) => setTimeout(resolve, 500))
  signal('SIGKILL')
  const cleanupEnd = performance.now() + 1500
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      proc.exited,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Owned process did not reap within cleanup budget')), 1500)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
  while (groupAlive(proc.pid)) {
    if (performance.now() >= cleanupEnd) throw new Error('Owned descendants survived cleanup budget')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

export async function disposeActiveProcesses(): Promise<void> {
  const results = await Promise.allSettled([...activeProcesses].map((session) => session.dispose()))
  const failed = results.find((result) => result.status === 'rejected')
  if (failed?.status === 'rejected') throw failed.reason
}
