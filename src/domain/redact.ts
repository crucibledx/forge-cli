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
const assignmentStart =
  /(?<![a-z\d_.%+\\-])(?:(?:"((?:\\.|[^"\\\r\n])*)"|'((?:\\.|[^'\\\r\n])*)')[ \t\r\n]*|([a-z_%][a-z\d_.%+-]*)[ \t]*)[=:]/gi
const authStart = /(?:Bearer|Basic)\s+/gi

function assignmentKey(name: string) {
  return name
    .replace(/\\u([a-f\d]{4})/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/\\(["'\\/])/g, '$1')
}

function credentialQueryKey(name: string, complete = true): boolean {
  const decoded = name
    .replace(/%([a-f\d]{2})/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)))
    .toLowerCase()
  // Azure SAS uses this short alias; matching it as a fragment would hide "design".
  return (complete && decoded === 'sig') || queryKeys.some((key) => decoded.includes(key))
}

function* credentialAssignments(text: string) {
  const end = Math.max(text.lastIndexOf('='), text.lastIndexOf(':')) + 1
  const input = text.slice(0, end)
  assignmentStart.lastIndex = queryStart.lastIndex = 0
  const names = input.matchAll(queryStart)
  let query = names.next().value
  for (const match of input.matchAll(assignmentStart)) {
    while (query && query.index + query[0].length <= match.index) query = names.next().value
    // Query values have their own delimiter rules, including literal quotes.
    if (query && query.index <= match.index) continue
    if (credentialQueryKey(assignmentKey(match[1] ?? match[2] ?? match[3])))
      yield {index: match.index, length: match[0].length, quoted: match[3] === undefined}
  }
}

function credentialValue(
  text: string,
  start: number,
  authorization = false,
  token = false,
  whitespace: 'horizontal' | 'quoted' | 'assignment' = 'horizontal',
) {
  while (start < text.length && (whitespace === 'quoted' ? /[ \t\r\n]/ : /[ \t]/).test(text[start])) start++
  let pendingWhitespace = ''
  if (whitespace === 'assignment' && /[\r\n]/.test(text[start] ?? '')) {
    let cursor = start,
      indented = false
    while (cursor < text.length && /[ \t\r\n]/.test(text[cursor])) {
      indented = !/[\r\n]/.test(text[cursor])
      cursor++
    }
    // An indented continuation is a value; an unindented next diagnostic is not.
    if (cursor < text.length && !indented) return {start, end: start, continuation: undefined}
    if (cursor === text.length) pendingWhitespace = indented ? '\n ' : '\n'
    start = cursor
  }
  let end = start
  if (authorization) {
    const scheme = /^(?:Basic|Bearer)[ \t]+/i.exec(text.slice(start))
    if (scheme) {
      end += scheme[0].length
      token = true
    }
  }
  const quote = text[end]
  if (quote === '"' || quote === "'") {
    let escaped = false
    for (end++; end < text.length; end++) {
      if (text[end] === quote && !escaped) return {start, end: end + 1, continuation: undefined}
      escaped = text[end] === '\\' && !escaped
    }
    return {start, end, continuation: quote + 'x' + (escaped ? '\\' : '')}
  }
  while (end < text.length && (token ? /[a-z\d._~+/=-]/i.test(text[end]) : !/[\s&]/.test(text[end]))) end++
  return {start, end, continuation: end === text.length ? (end > start ? 'x' : pendingWhitespace) : undefined}
}

/** Keep quote/key syntax and keyword states, never an arbitrary discarded value. */
function quotedKeyContext(text: string): string {
  let quote = '',
    start = 0,
    escaped = false,
    closed: {quote: string; name: string} | undefined
  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (!quote) {
      if (char === '"' || char === "'") {
        quote = char
        start = index + 1
        closed = undefined
      } else if (!/[ \t\r\n]/.test(char)) closed = undefined
    } else if (char === quote && !escaped) {
      closed = {quote, name: text.slice(start, index)}
      quote = ''
    } else escaped = char === '\\' && !escaped
  }
  if (!quote)
    return closed && credentialQueryKey(assignmentKey(closed.name)) ? `${closed.quote}secret${closed.quote}` : ''
  const name = text.slice(start)
  const encoding = finalMatch(name, /\\(?:u[a-f\d]{0,3})?$/i)?.[0] ?? finalMatch(name, /%[a-f\d]?$/i)?.[0] ?? ''
  const decoded = assignmentKey(encoding ? name.slice(0, -encoding.length) : name)
    .replace(/%([a-f\d]{2})/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)))
    .toLowerCase()
  if (credentialQueryKey(decoded, false)) return quote + 'secret'
  let partial = ''
  for (const key of queryKeys)
    for (let size = key.length; size > partial.length; size--)
      if (decoded.endsWith(key.slice(0, size))) {
        partial = key.slice(0, size)
        break
      }
  return quote + (decoded.length > partial.length ? 'q' : '') + partial + encoding
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
  // A partial "sig" can still become the public name "signal".
  if (credentialQueryKey(match[1], false)) return '?token'
  // Retain enough syntax for a fragment split anywhere in percent encoding.
  // Arbitrary provider prefixes may be evicted without retaining unbounded keys.
  const limit = 3 * Math.max(...queryKeys.map((key) => key.length))
  return '?' + (match[1].length > limit ? 'q' : '') + match[1].slice(-limit)
}

interface RedactionOptions {
  secrets?: readonly string[]
  credentialPrefixes?: readonly string[]
  secretPrefix?: string
  spans?: readonly RedactionSpan[]
}
export interface RedactionSpan {
  start: number
  end: number
}
export interface RedactionSegment {
  raw: number
  visible: number
  length: number
}

/** Project ordered spans through monotonic UTF-16 segments, accounting for independent view eviction. */
export function projectRedactionSpans(
  spans: readonly RedactionSpan[],
  segments: readonly RedactionSegment[],
  from: 'raw' | 'visible',
  to: 'raw' | 'visible',
  offsets = {raw: 0, visible: 0},
): RedactionSpan[] {
  const projected: RedactionSpan[] = []
  let index = 0
  for (const span of spans) {
    const first = offsets[from] + span.start,
      last = offsets[from] + span.end
    while (index < segments.length && segments[index][from] + segments[index].length <= first) index++
    let start: number | undefined,
      end = 0
    for (let i = index; i < segments.length && segments[i][from] < last; i++) {
      const segment = segments[i]
      start ??= segment[to] + Math.max(0, first - segment[from])
      end = segment[to] + Math.min(segment.length, last - segment[from])
    }
    if (start !== undefined) projected.push({start: start - offsets[to], end: end - offsets[to]})
  }
  return projected
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
    const lastScheme = input.lastIndexOf('://')
    if (lastScheme < 0) continue
    // No scheme can start after the final delimiter. Avoid lookbehind scans
    // through a large ordinary tail; authority boundaries still use full input.
    for (const match of input.slice(0, lastScheme + 3).matchAll(/(?<![a-z\d+.-])[a-z][a-z\d+.-]*:\/\//gi)) {
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
    const scan = (pattern: RegExp, trailing = 0, input = credentialText) => {
      for (const match of input.matchAll(pattern)) {
        add(
          match.index + match[1].length - credentialPrefix.length,
          match.index + match[0].length - trailing - credentialPrefix.length,
        )
      }
    }
    const lastAt = credentialText.lastIndexOf('@')
    if (lastAt >= 0 && credentialText.includes('://'))
      scan(/(?<![a-z\d+.-])([a-z][a-z\d+.-]*:\/\/)[^\s/?#]+@/gi, 1, credentialText.slice(0, lastAt + 1))
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
    let covered = -1
    for (const match of credentialText.matchAll(authStart)) {
      if (match.index < covered) continue
      const value = credentialValue(credentialText, match.index + match[0].length, false, true)
      covered = value.end
      add(value.start - credentialPrefix.length, value.end - credentialPrefix.length)
    }
    covered = -1
    for (const match of credentialAssignments(credentialText)) {
      if (match.index < covered) continue
      if (!credentialPrefix && match.index === 0 && options.credentialPrefixes?.includes('_')) continue
      const value = credentialValue(
        credentialText,
        match.index + match.length,
        true,
        false,
        match.quoted ? 'quoted' : 'assignment',
      )
      covered = value.end
      add(value.start - credentialPrefix.length, value.end - credentialPrefix.length)
    }
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
    const segments: RedactionSegment[] = []
    let visible = 0
    const plain = createAnsiText((start, end) => {
      segments.push({raw: start, visible, length: end - start})
      visible += end - start
    })(text)
    for (const span of projectRedactionSpans(recognize(plain), segments, 'visible', 'raw')) spans.push(span)
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
  let covered = -1
  for (const match of discarded.matchAll(authStart)) {
    if (match.index < covered) continue
    const value = credentialValue(discarded, match.index + match[0].length, false, true)
    covered = value.end
    if (value.continuation !== undefined) contexts.add('Bearer ' + value.continuation)
  }
  covered = -1
  for (const match of credentialAssignments(discarded)) {
    if (match.index < covered) continue
    const value = credentialValue(
      discarded,
      match.index + match.length,
      true,
      false,
      match.quoted ? 'quoted' : 'assignment',
    )
    covered = value.end
    if (value.continuation !== undefined) contexts.add((match.quoted ? '"secret":' : 'secret=') + value.continuation)
  }
  const quotedKey = quotedKeyContext(discarded)
  if (quotedKey) contexts.add(quotedKey)
  const pendingName = finalMatch(discarded, /(?<![a-z\d_.%+-])([a-z_%][a-z\d_.%+-]*)[ \t]*$/i)
  if (pendingName && credentialQueryKey(pendingName[1], false)) contexts.add('secret')
  if (finalMatch(discarded, /(?<![a-z\d+.-])[a-z][a-z\d+.-]*:\/\/[^\s/?#]*$/i)) contexts.add('https://')
  let partial = ''
  const encoding = finalMatch(discarded, /%[a-f\d]?$/i)?.[0] ?? ''
  const lower = (encoding ? discarded.slice(0, -encoding.length) : discarded)
    .replace(/%([a-f\d]{2})/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)))
    .toLowerCase()
  for (const marker of [
    'Bearer',
    'Basic',
    ...queryKeys.map((key) => `${key}=`),
    'authorization=',
    'token:',
    'password:',
    'secret:',
    'authorization:',
  ]) {
    for (let size = marker.length; size > partial.length; size--)
      if (lower.endsWith(marker.slice(0, size).toLowerCase())) {
        partial = marker.slice(0, size)
        break
      }
  }
  if (partial || encoding)
    contexts.add((/[a-z\d_.%+-]/i.test(lower.at(-partial.length - 1) ?? '') ? 'q' : '') + partial + encoding)
  const scheme = finalMatch(discarded, /(?<![a-z\d+.-])[a-z][a-z\d+.-]*:(\/?)$/i)
  if (scheme) contexts.add(`https:${scheme[1]}`)
  // A partial URI scheme can coexist with another recognizer, such as Bearer.
  if (finalMatch(discarded, /[a-z\d+.-]$/i)) contexts.add('x')
  // A raw tail starting mid-name cannot establish a fresh exact short alias.
  if (finalMatch(discarded, /[a-z\d_.%+-]$/i)) contexts.add('_')
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
