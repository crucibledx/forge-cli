import stripAnsi from 'strip-ansi'

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
  let result = text
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[redacted]@')
    .replace(/((?:token|password|secret|authorization)[=:]\s*)[^\s&]+/gi, '$1[redacted]')
    .replaceAll(cwd, '<project>')
  for (const secret of secrets.filter(Boolean)) result = result.replaceAll(secret, '[redacted]')
  return result
}

export function createTranscript() {
  const decoder = new TextDecoder()
  let raw = ''
  let offset = 0
  function add(text: string): void {
    raw += text
    const bytes = Buffer.from(raw)
    if (bytes.length > TAIL_BYTES) {
      let start = bytes.length - TAIL_BYTES
      while ((bytes[start] & 0xc0) === 0x80) start++
      offset += stripAnsi(bytes.subarray(0, start).toString()).length
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
      return stripAnsi(raw)
    },
    rawText() {
      return raw
    },
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
  if (process.platform !== 'win32') {
    try {
      process.kill(-proc.pid, 0)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
      await proc.exited
      return
    }
  }
  const signal = (force: boolean) => {
    if (process.platform === 'win32') {
      Bun.spawnSync(['taskkill', '/pid', String(proc.pid), '/T', ...(force ? ['/F'] : [])], {
        stdout: 'ignore',
        stderr: 'ignore',
        timeout: 500,
      })
    } else {
      try {
        process.kill(-proc.pid, force ? 'SIGKILL' : 'SIGTERM')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
      }
    }
  }
  signal(false)
  // Always escalate the group, even if its leader exited before its descendants.
  await new Promise((resolve) => setTimeout(resolve, 500))
  signal(true)
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
  if (process.platform !== 'win32') {
    while (groupAlive(proc.pid)) {
      if (performance.now() >= cleanupEnd) throw new Error('Owned descendants survived cleanup budget')
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
  }
}

export async function disposeActiveProcesses(): Promise<void> {
  const results = await Promise.allSettled([...activeProcesses].map((session) => session.dispose()))
  const failed = results.find((result) => result.status === 'rejected')
  if (failed?.status === 'rejected') throw failed.reason
}
