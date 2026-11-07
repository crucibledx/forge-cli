import {createAnsiText} from './ansi-text'

const queryKeys = ['access_token', 'token', 'password', 'secret', 'key', 'auth']
const queryMarker = `[?&#](?:${queryKeys
  .map((key) =>
    [...key]
      .map(
        (char) =>
          `(?:${char}|${[...new Set([char, char.toUpperCase()])].map((value) => '%' + value.charCodeAt(0).toString(16)).join('|')})`,
      )
      .join(''),
  )
  .join('|')})=`
const queryValue = new RegExp(`(${queryMarker})[^&#\\s"]+`, 'gi')
const unfinishedQuery = new RegExp(`${queryMarker}[^&#\\s"]*$`, 'i')
const queryStart = new RegExp(queryMarker, 'gi')
const assignmentStart = /(?:token|password|secret|authorization)[=:]/gi

function lastMarkerSuffix(text: string, marker: RegExp): string {
  marker.lastIndex = 0
  let start = -1
  for (let match = marker.exec(text); match; match = marker.exec(text)) start = match.index
  return start < 0 ? '' : text.slice(start)
}

function finalMatch(text: string, pattern: RegExp): RegExpExecArray | null {
  const match = pattern.exec(text)
  // JavaScript's $ can stop before a final newline, which terminates a value.
  return match && match.index + match[0].length === text.length ? match : null
}

function unfinishedQueryName(text: string): string {
  const match = finalMatch(text, /[?&#]((?:[a-z_]|%[a-f\d]{2})*(?:%[a-f\d]?)?)$/i)
  if (!match) return ''
  const partial = /%[a-f\d]?$/i.exec(match[1])?.[0] ?? ''
  const name = match[1]
    .slice(0, match[1].length - partial.length)
    .replace(/%([a-f\d]{2})/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)))
    .toLowerCase()
  const possible = queryKeys.some((key) => {
    if (!key.startsWith(name)) return false
    if (!partial) return true
    const next = key[name.length]
    return (
      next &&
      [next, next.toUpperCase()].some((char) =>
        char.charCodeAt(0).toString(16).startsWith(partial.slice(1).toLowerCase()),
      )
    )
  })
  return possible ? match[0].toLowerCase() : ''
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
    scan(queryValue)
    scan(/(Bearer\s+)[a-z\d._~+/-]+=*/gi)
    if (options.assignments) scan(/((?:token|password|secret|authorization)[=:]\s*)[^\s&]+/gi)
  }

  const secretPrefix = options.secretPrefix ?? ''
  const secretText = secretPrefix + text
  for (const secret of options.secrets ?? []) {
    if (!secret) continue
    for (let at = secretText.indexOf(secret); at >= 0; at = secretText.indexOf(secret, at + 1)) {
      add(at - secretPrefix.length, at + secret.length - secretPrefix.length)
    }
    // Conservatively hide an incomplete known continuation at the raw boundary.
    for (let size = Math.min(secret.length - 1, secretPrefix.length); size > 0; size--) {
      if (secretPrefix.endsWith(secret.slice(0, size)) && secret.slice(size).startsWith(text)) add(0, text.length)
    }
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
  if (finalMatch(lastMarkerSuffix(discarded, queryStart), unfinishedQuery)) contexts.add('?token=x')
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
      Object.entries(value).map(([key, data]) => [
        key,
        /^(?:password|token|secret|authorization|access_token)$/i.test(key) ? '[redacted]' : redactData(data),
      ]),
    ) as T
  }
  return value
}
