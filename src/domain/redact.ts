import {createAnsiText} from './ansi-text'

// Credential fragments cover compound/provider-specific names, not an exhaustive
// allowlist of six exact query keys. Decode names before matching, never values.
const queryKeys = [
  'token',
  'password',
  'passwd',
  'pwd',
  'secret',
  'key',
  'auth',
  'credential',
  'bearer',
  'jwt',
  'signature',
  'session',
]
const queryStart = /[?&#]([^?&#=\s]+)=/g
const assignmentStart = /(?:token|password|secret|authorization)[=:]/gi

function credentialQueryKey(name: string): boolean {
  const decoded = name
    .replace(/%([a-f\d]{2})/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)))
    .toLowerCase()
  return queryKeys.some((key) => decoded.includes(key))
}

function lastMarkerSuffix(text: string, marker: RegExp, accept = (_match: RegExpExecArray) => true): string {
  marker.lastIndex = 0
  let start = -1
  for (let match = marker.exec(text); match; match = marker.exec(text)) if (accept(match)) start = match.index
  return start < 0 ? '' : text.slice(start)
}

function finalMatch(text: string, pattern: RegExp): RegExpExecArray | null {
  const match = pattern.exec(text)
  // JavaScript's $ can stop before a final newline, which terminates a value.
  return match && match.index + match[0].length === text.length ? match : null
}

function unfinishedQueryName(text: string): string {
  const match = finalMatch(text, /[?&#]([^?&#=\s]*)$/)
  if (!match) return ''
  if (credentialQueryKey(match[1])) return '?token'
  // Retain enough syntax for a fragment split anywhere in percent encoding.
  // Arbitrary provider prefixes may be evicted without retaining unbounded keys.
  return '?q' + match[1].slice(-3 * Math.max(...queryKeys.map((key) => key.length)))
}

interface RedactionOptions {
  secrets?: readonly string[]
  credentialPrefixes?: readonly string[]
  secretPrefix?: string
  assignments?: boolean
  spans?: readonly RedactionSpan[]
}
export interface RedactionSpan {
  start: number
  end: number
}

function mergeSpans(spans: readonly RedactionSpan[], length: number): RedactionSpan[] {
  const sorted = spans
    .map(({start, end}) => ({start: Math.max(0, start), end: Math.min(length, end)}))
    .filter(({start, end}) => start < end)
    .sort((a, b) => a.start - b.start || a.end - b.end)
  const merged: RedactionSpan[] = []
  for (const span of sorted) {
    const previous = merged.at(-1)
    if (previous && span.start <= previous.end) previous.end = Math.max(previous.end, span.end)
    else merged.push(span)
  }
  return merged
}

/** Tentative authority privacy is reversible when a path/query/fragment proves its boundary. */
export function diagnosticAuthoritySpans(text: string, prefixes: readonly string[] = []) {
  const pending: RedactionSpan[] = [],
    resolved: RedactionSpan[] = []
  let continuing = false
  for (const prefix of ['', ...prefixes]) {
    const input = prefix + text
    for (const match of input.matchAll(/(?<![a-z\d+.-])[a-z][a-z\d+.-]*:\/\//gi)) {
      const start = match.index + match[0].length
      let end = start
      while (end < input.length && !/[/?#\s\p{Cc}]/u.test(input[end])) end++
      if (end === input.length) continuing = true
      const destination = end < input.length && '/?#'.includes(input[end]) ? resolved : pending
      destination.push({start: start - prefix.length, end: end - prefix.length})
    }
  }
  return {pending: mergeSpans(pending, text.length), resolved: mergeSpans(resolved, text.length), continuing}
}

/** Linear subtraction after sorting, never a Cartesian scan of diagnostic ranges. */
export function subtractRedactionSpans(
  spans: readonly RedactionSpan[],
  excluded: readonly RedactionSpan[],
  length: number,
): RedactionSpan[] {
  const cuts = mergeSpans(excluded, length),
    result: RedactionSpan[] = []
  let index = 0
  for (const span of mergeSpans(spans, length)) {
    let cursor = span.start
    while (index < cuts.length && cuts[index].end <= cursor) index++
    for (let i = index; i < cuts.length && cuts[i].start < span.end; i++) {
      if (cursor < cuts[i].start) result.push({start: cursor, end: Math.min(span.end, cuts[i].start)})
      cursor = Math.max(cursor, cuts[i].end)
    }
    if (cursor < span.end) result.push({start: cursor, end: span.end})
  }
  return result
}

/** KMP keeps full matches and suffix state linear, including repetitive fixture secrets. */
function matchSecret(text: string, secret: string, found?: (start: number) => void) {
  const fallback = new Uint32Array(secret.length)
  for (let index = 1, matched = 0; index < secret.length; index++) {
    while (matched && secret[index] !== secret[matched]) matched = fallback[matched - 1]
    if (secret[index] === secret[matched]) matched++
    fallback[index] = matched
  }
  let matched = 0
  for (let index = 0; index < text.length; index++) {
    while (matched && (matched === secret.length || text[index] !== secret[matched])) matched = fallback[matched - 1]
    if (text[index] === secret[matched]) matched++
    if (matched === secret.length) found?.(index + 1 - matched)
  }
  return {matched, proper: matched === secret.length ? fallback[matched - 1] : matched}
}
/** Retain only a known proper-prefix suffix, never discarded arbitrary stream bytes. */
export function redactionSecretPrefix(text: string, secrets: readonly string[]): string {
  let prefix = ''
  for (const secret of secrets) {
    if (!secret) continue
    const size = matchSecret(text, secret).proper
    if (size > prefix.length) prefix = secret.slice(0, size)
  }
  return prefix
}

/** Recognize every span against unchanged input, then mask their union. */
export function redactionSpans(text: string, options: RedactionOptions = {}): RedactionSpan[] {
  const spans: RedactionSpan[] = []
  const add = (start: number, end: number) => {
    spans.push({start, end})
  }
  for (const span of options.spans ?? []) add(span.start, span.end)
  for (const credentialPrefix of ['', ...(options.credentialPrefixes ?? [])]) {
    const credentialText = credentialPrefix + text
    const scan = (pattern: RegExp, trailing = 0) => {
      for (const match of credentialText.matchAll(pattern)) {
        add(
          match.index + match[1].length - credentialPrefix.length,
          match.index + match[0].length - trailing - credentialPrefix.length,
        )
      }
    }
    scan(/(?<![a-z\d+.-])([a-z][a-z\d+.-]*:\/\/)[^\s/]+@/gi, 1)
    queryStart.lastIndex = 0
    for (let match = queryStart.exec(credentialText); match; match = queryStart.exec(credentialText)) {
      if (!credentialQueryKey(match[1])) continue
      const start = match.index + match[0].length
      let end = start
      while (end < credentialText.length && !/[&#\s]/.test(credentialText[end])) end++
      add(start - credentialPrefix.length, end - credentialPrefix.length)
      // Do not rescan nested query-looking bytes already covered by this span.
      queryStart.lastIndex = end
    }
    scan(/(Bearer\s+)[a-z\d._~+/-]+=*/gi)
    if (options.assignments) scan(/((?:token|password|secret|authorization)[=:]\s*)[^\s&]+/gi)
  }

  const secretPrefix = options.secretPrefix ?? ''
  const secretText = secretPrefix + text
  for (const secret of options.secrets ?? []) {
    if (!secret) continue
    const {matched} = matchSecret(secretText, secret, (at) =>
      add(at - secretPrefix.length, at + secret.length - secretPrefix.length),
    )
    // Conservatively hide an incomplete known continuation at the raw boundary.
    if (matched > text.length) add(0, text.length)
  }
  return mergeSpans(spans, text.length)
}
export function maskRedactionSpans(text: string, spans: readonly RedactionSpan[]) {
  const merged = mergeSpans(spans, text.length)
  let result = '',
    cursor = 0
  for (const span of merged) {
    result += text.slice(cursor, span.start) + '[redacted]'
    cursor = span.end
  }
  return {text: result + text.slice(cursor), spans: merged}
}
export function redact(text: string, options: RedactionOptions = {}): string {
  const recognize = (value: string) =>
    mergeSpans(
      [
        ...redactionSpans(value, options),
        // A complete userinfo delimiter keeps its public host; unfinished authorities remain private.
        ...diagnosticAuthoritySpans(value, options.credentialPrefixes).pending.filter(
          ({start, end}) => !value.slice(start, end).includes('@'),
        ),
      ],
      value.length,
    )
  const spans = recognize(text)
  if (/[\u001b\u009b\u009d]/.test(text)) {
    const segments: {raw: number; visible: number; length: number}[] = []
    let visible = 0
    const plain = createAnsiText((start, end) => {
      segments.push({raw: start, visible, length: end - start})
      visible += end - start
    })(text)
    let index = 0
    for (const span of recognize(plain)) {
      while (index < segments.length && segments[index].visible + segments[index].length <= span.start) index++
      let start: number | undefined,
        end = 0
      for (let i = index; i < segments.length && segments[i].visible < span.end; i++) {
        const segment = segments[i]
        start ??= segment.raw + Math.max(0, span.start - segment.visible)
        end = segment.raw + Math.min(segment.length, span.end - segment.visible)
      }
      if (start !== undefined) spans.push({start, end})
    }
  }
  return maskRedactionSpans(text, spans).text
}
/** Finite syntax-only contexts for concurrent recognizers. Never publish these. */
export function redactionContext(discarded: string): string[] {
  const contexts = new Set<string>()
  if (
    finalMatch(
      lastMarkerSuffix(discarded, queryStart, (match) => credentialQueryKey(match[1])),
      /^[?&#][^?&#=\s]+=[^&#\s]*$/,
    )
  )
    contexts.add('?token=x')
  const queryName = unfinishedQueryName(discarded)
  if (queryName) contexts.add(queryName)
  const bearer = finalMatch(discarded, /Bearer\s+([a-z\d._~+/-]*=*)$/i)
  if (bearer) contexts.add(bearer[1] ? 'Bearer x' : 'Bearer ')
  const assignment = finalMatch(
    lastMarkerSuffix(discarded, assignmentStart),
    /^(?:token|password|secret|authorization)[=:]\s*([^\s&]*)$/i,
  )
  if (assignment) contexts.add(assignment[1] ? 'secret=x' : 'secret=')
  if (finalMatch(discarded, /(?<![a-z\d+.-])[a-z][a-z\d+.-]*:\/\/[^\s/]*$/i)) contexts.add('https://')
  let partial = ''
  for (const marker of [
    'Bearer',
    ...queryKeys.map((key) => `${key}=`),
    'authorization=',
    'token:',
    'password:',
    'secret:',
    'authorization:',
  ]) {
    for (let size = marker.length; size > partial.length; size--)
      if (discarded.toLowerCase().endsWith(marker.slice(0, size).toLowerCase())) {
        partial = marker.slice(0, size)
        break
      }
  }
  if (partial) contexts.add(partial)
  const scheme = finalMatch(discarded, /(?<![a-z\d+.-])[a-z][a-z\d+.-]*:(\/?)$/i)
  if (scheme) contexts.add(`https:${scheme[1]}`)
  // A partial URI scheme can coexist with another recognizer, such as Bearer.
  if (finalMatch(discarded, /[a-z\d+.-]$/i)) contexts.add('x')
  return [...contexts]
}

export function redactData<T>(value: T): T {
  if (typeof value === 'string') return redact(value) as T
  if (Array.isArray(value)) return value.map(redactData) as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, data]) => [key, credentialQueryKey(key) ? '[redacted]' : redactData(data)]),
    ) as T
  }
  return value
}
