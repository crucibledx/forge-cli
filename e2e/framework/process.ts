import {createAnsiText} from '../../src/domain/ansi-text'
import type {RedactionSpan} from '../../src/domain/redact'
import {
  diagnosticAuthoritySpans,
  maskRedactionSpans,
  redact,
  redactionContext,
  redactionSecretPrefix,
  redactionSpans,
  subtractRedactionSpans,
} from '../../src/domain/redact'
import {windowsJobs} from './windows-job'
export const SESSION_MS = 10_000
export const TAIL_BYTES = 256 * 1024
export const activeProcesses = new Set<{dispose(): Promise<void>}>()

/** Public session waits must settle even when bounded process cleanup rejects. */
export function ownSession(cleanup: () => Promise<void>) {
  let resolve!: () => void
  let reject!: (error: unknown) => void
  const finished = new Promise<void>((yes, no) => {
    resolve = yes
    reject = no
  })
  // A caller may dispose before it starts waiting for exit.
  void finished.catch(() => {})
  let disposal: Promise<void> | undefined
  const owner = {
    finished,
    dispose() {
      if (!disposal) {
        disposal = (async () => {
          try {
            await cleanup()
          } finally {
            activeProcesses.delete(owner)
          }
        })()
        void disposal.then(resolve, reject)
      }
      return disposal
    },
  }
  activeProcesses.add(owner)
  return owner
}

export function sessionBudget(timeoutMs = SESSION_MS): number {
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000) {
    throw new Error('Session timeout must be between 1 and 30000 ms')
  }
  return timeoutMs
}

export function sanitize(text: string, cwd: string, secrets: string[] = []): string {
  const cleaned = redact(text, {secrets, assignments: true})
  return cwd ? cleaned.replaceAll(cwd, '<project>') : cleaned
}
export function diagnosticTail(text: string, maximum = TAIL_BYTES): string {
  const bytes = Buffer.from(text)
  let start = Math.max(0, bytes.length - maximum)
  while ((bytes[start] & 0xc0) === 0x80) start++
  return bytes.subarray(start).toString()
}
export function diagnosticHead(text: string, maximum: number): string {
  const bytes = Buffer.from(text)
  let end = Math.min(bytes.length, maximum)
  while ((bytes[end] & 0xc0) === 0x80) end--
  return bytes.subarray(0, end).toString()
}
/** Bound the encoded JSON string; >=13 bytes reserves the visible truncation marker and quotes. */
export function diagnosticJSON(text: string, maximum: number, tail = false): string {
  if (!Number.isSafeInteger(maximum) || maximum < 13) throw new RangeError('JSON diagnostic budget must be >=13')
  if (Buffer.byteLength(JSON.stringify(text)) <= maximum) return text
  const marker = '[truncated]'
  let remaining = maximum - marker.length - 2
  const cost = (point: number) =>
    point < 32
      ? [8, 9, 10, 12, 13].includes(point)
        ? 2
        : 6
      : point === 34 || point === 92
        ? 2
        : point < 128
          ? 1
          : point < 2048
            ? 2
            : point >= 0xd800 && point <= 0xdfff
              ? 6
              : point <= 0xffff
                ? 3
                : 4
  let index = tail ? text.length : 0
  while (tail ? index > 0 : index < text.length) {
    let start = tail ? index - 1 : index
    if (
      tail &&
      start > 0 &&
      text.charCodeAt(start) >= 0xdc00 &&
      text.charCodeAt(start) <= 0xdfff &&
      text.charCodeAt(start - 1) >= 0xd800 &&
      text.charCodeAt(start - 1) <= 0xdbff
    )
      start--
    const point = text.codePointAt(start)!,
      size = cost(point)
    if (size > remaining) break
    remaining -= size
    index = tail ? start : index + (point > 0xffff ? 2 : 1)
  }
  return tail ? marker + text.slice(index) : text.slice(0, index) + marker
}
function diagnosticView(clean: (text: string) => string, secrets: string[]) {
  let raw = ''
  let offset = 0
  let contexts: string[] = []
  let authorityContexts: string[] = []
  let secretPrefix = ''
  let diagnostic = ''
  let protectedSpans: RedactionSpan[] = []
  let tentativeSpans: RedactionSpan[] = []
  const options = () => ({
    credentialPrefixes: contexts,
    secretPrefix,
    secrets,
    assignments: true,
  })
  function add(text: string, spans: RedactionSpan[], pending: RedactionSpan[], resolved: RedactionSpan[]): void {
    raw += text
    const confirmed = maskRedactionSpans(raw, spans).spans
    const tentative = maskRedactionSpans(raw, [
      ...subtractRedactionSpans(tentativeSpans, resolved, raw.length),
      ...pending,
    ]).spans
    const masked = maskRedactionSpans(raw, [...confirmed, ...tentative])
    diagnostic = diagnosticTail(clean(masked.text))
    const previousOffset = offset
    const bytes = Buffer.from(raw)
    if (bytes.length > TAIL_BYTES) {
      let start = bytes.length - TAIL_BYTES
      while ((bytes[start] & 0xc0) === 0x80) start++
      const discarded = bytes.subarray(0, start).toString()
      // Query/fragment contexts are useful to confirmed recognizers, not evidence of an unfinished authority.
      authorityContexts = [
        ...new Set(
          [...authorityContexts, ''].flatMap((prefix) => {
            const input = prefix + discarded
            return [
              ...(diagnosticAuthoritySpans(input).continuing ? ['https://'] : []),
              ...redactionContext(input).filter((value) => ['x', 'https:', 'https:/'].includes(value)),
            ]
          }),
        ),
      ]
      contexts = [...new Set([...contexts, ''].flatMap((prefix) => redactionContext(prefix + discarded)))]
      secretPrefix = redactionSecretPrefix(secretPrefix + discarded, secrets)
      const retained = bytes.subarray(start).toString()
      offset += raw.length - retained.length
      raw = retained
    }
    // A projected range remains private until this view evicts it, even when
    // formatting makes its source view evict the corresponding bytes first.
    const removed = offset - previousOffset
    protectedSpans = confirmed
      .map(({start, end}) => ({start: Math.max(0, start - removed), end: end - removed}))
      .filter(({start, end}) => start < end)
    tentativeSpans = tentative
      .map(({start, end}) => ({start: Math.max(0, start - removed), end: end - removed}))
      .filter(({start, end}) => start < end)
  }

  return {
    get offset() {
      return offset
    },
    append: add,
    spans: (text: string) => redactionSpans(raw + text, {...options(), spans: protectedSpans}),
    authorities: (text: string) => diagnosticAuthoritySpans(raw + text, authorityContexts),
    text() {
      return raw
    },
    diagnostic() {
      return diagnostic
    },
  }
}

export function createTranscript(clean: (text: string) => string = (text) => text, secrets: string[] = []) {
  const decoder = new TextDecoder()
  const raw = diagnosticView(clean, secrets)
  const visible = diagnosticView(clean, secrets)
  const views = {raw, visible}
  let segments: {raw: number; visible: number; length: number}[] = []
  let rawEnd = 0,
    visibleEnd = 0
  const plainText = createAnsiText((start, end) => {
    const previous = segments.at(-1)
    if (
      previous &&
      previous.raw + previous.length === rawEnd + start &&
      previous.visible + previous.length === visibleEnd
    )
      previous.length += end - start
    else segments.push({raw: rawEnd + start, visible: visibleEnd, length: end - start})
    visibleEnd += end - start
  })
  function project(spansToProject: RedactionSpan[], from: keyof typeof views, to: keyof typeof views) {
    const spans: RedactionSpan[] = []
    let index = 0
    for (const span of spansToProject) {
      const first = views[from].offset + span.start,
        last = views[from].offset + span.end
      while (index < segments.length && segments[index][from] + segments[index].length <= first) index++
      let start: number | undefined,
        end = 0
      for (let i = index; i < segments.length && segments[i][from] < last; i++) {
        const segment = segments[i]
        start ??= segment[to] + Math.max(0, first - segment[from])
        end = segment[to] + Math.min(segment.length, last - segment[from])
      }
      if (start !== undefined) spans.push({start: start - views[to].offset, end: end - views[to].offset})
    }
    return spans
  }
  function add(text: string) {
    rawEnd = raw.offset + raw.text().length
    visibleEnd = visible.offset + visible.text().length
    const plain = plainText(text)
    // Recognize unchanged input in both views before projecting either result.
    // Private assertion buffers and offsets do not consume these masks.
    const rawSpans = raw.spans(text),
      visibleSpans = visible.spans(plain)
    const rawUnion = [...rawSpans, ...project(visibleSpans, 'visible', 'raw')],
      visibleUnion = [...visibleSpans, ...project(rawSpans, 'raw', 'visible')]
    const rawAuthorities = raw.authorities(text),
      visibleAuthorities = visible.authorities(plain)
    // Project every range before either view advances its eviction offset.
    const rawPending = [...rawAuthorities.pending, ...project(visibleAuthorities.pending, 'visible', 'raw')],
      visiblePending = [...visibleAuthorities.pending, ...project(rawAuthorities.pending, 'raw', 'visible')],
      rawResolved = [...rawAuthorities.resolved, ...project(visibleAuthorities.resolved, 'visible', 'raw')],
      visibleResolved = [...visibleAuthorities.resolved, ...project(rawAuthorities.resolved, 'raw', 'visible')]
    raw.append(text, rawUnion, rawPending, rawResolved)
    visible.append(plain, visibleUnion, visiblePending, visibleResolved)
    segments = segments.filter(
      (segment) => segment.raw + segment.length > raw.offset && segment.visible + segment.length > visible.offset,
    )
  }
  return {
    get offset() {
      return visible.offset
    },
    append(bytes: Uint8Array) {
      add(decoder.decode(bytes, {stream: true}))
    },
    finish() {
      add(decoder.decode())
    },
    text: visible.text,
    rawText: raw.text,
    diagnostic: raw.diagnostic,
    visibleDiagnostic: visible.diagnostic,
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

export type OwnedProcess = Pick<Bun.Subprocess, 'pid' | 'exited' | 'kill' | 'exitCode'>

function groupAlive(pid: number, env: Record<string, string>): boolean {
  // On macOS, signal-zero may return EPERM for an orphan already awaiting init's
  // reap. Zombies have no running code or open descriptors, but are still PIDs.
  const result = Bun.spawnSync(['ps', '-axo', 'pgid=,stat='], {env, stdout: 'pipe', stderr: 'pipe'})
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
export async function terminateTree(proc: OwnedProcess, env: Record<string, string>): Promise<void> {
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
  const cleanupEnd = performance.now() + 2000
  const signal = async (value: NodeJS.Signals | 0) => {
    for (;;) {
      try {
        process.kill(-proc.pid, value)
        return true
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code
        if (code === 'ESRCH') return false
        if (code !== 'EPERM') throw error
        // Darwin can report EPERM before an exiting orphan appears as a zombie.
        // Retry inside the SAME cleanup budget; a live denial must still fail.
        if (!groupAlive(proc.pid, env)) return false
        if (performance.now() >= cleanupEnd) throw error
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
    }
  }
  if ((await signal(0)) && (await signal('SIGTERM'))) {
    // Always escalate the group, even if its leader exited before descendants.
    await new Promise((resolve) => setTimeout(resolve, Math.min(500, Math.max(0, cleanupEnd - performance.now()))))
    await signal('SIGKILL')
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      proc.exited,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Owned process did not reap within cleanup budget')),
          Math.max(1, cleanupEnd - performance.now()),
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
  while (groupAlive(proc.pid, env)) {
    if (performance.now() >= cleanupEnd) throw new Error('Owned descendants survived cleanup budget')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

export async function disposeActiveProcesses(): Promise<void> {
  const results = await Promise.allSettled([...activeProcesses].map((session) => session.dispose()))
  const failed = results.find((result) => result.status === 'rejected')
  if (failed?.status === 'rejected') throw failed.reason
}
