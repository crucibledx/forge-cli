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
// Escaped payloads encode whitespace as \n, \r or \t; that letter ends a word, not starts a key name.
const assignmentStart =
  /(?:(?<![a-z\d_.%+\\-])|(?<=(?-i:\\[nrt])))(?:(?:"((?:\\.|[^"\\\r\n])*)"|'((?:\\.|[^'\\\r\n])*)')[ \t\r\n]*|([a-z_%][a-z\d_.%+-]*)[ \t]*|\\+"([^"\r\n]*?)(?<!\\)\\+"[ \t\r\n]*)[=:]/gi
const authStart = /(?:Bearer|Basic)\s+/gi

function assignmentKey(name: string) {
  return name
    .replace(/(?<!\\)\\+u([a-f\d]{4})/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/\\(["'\\/])/g, '$1')
}

function credentialName(name: string): string {
  return name.replace(/%([a-f\d]{2})/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16))).toLowerCase()
}

function credentialQueryKey(name: string, complete = true): boolean {
  const decoded = credentialName(name)
  // Azure SAS uses this short alias; matching it as a fragment would hide "design".
  return (complete && decoded === 'sig') || queryKeys.some((key) => decoded.includes(key))
}

function lineKey(text: string, index: number) {
  const start = Math.max(text.lastIndexOf('\n', index - 1), text.lastIndexOf('\r', index - 1)) + 1
  const key = start + /^[ \t]*(?:-[ \t]+)*/.exec(text.slice(start))![0].length
  const ends = [text.indexOf('\n', index), text.indexOf('\r', index)].filter((end) => end >= 0)
  return {key, indent: key - start, end: ends.length ? Math.min(...ends) : -1}
}

function* credentialAssignments(text: string) {
  const end = Math.max(text.lastIndexOf('='), text.lastIndexOf(':')) + 1
  const input = text.slice(0, end)
  assignmentStart.lastIndex = queryStart.lastIndex = 0
  const names = input.matchAll(queryStart)
  let query = names.next().value
  let line = {key: 0, indent: 0, end: -1}
  let previousEnd = 0
  for (const match of input.matchAll(assignmentStart)) {
    const gapStart = previousEnd
    previousEnd = match.index + match[0].length
    while (query && query.index + query[0].length <= match.index) query = names.next().value
    // Query values have their own delimiter rules, including literal quotes.
    if (query && query.index <= match.index) continue
    if (credentialQueryKey(assignmentKey(match[1] ?? match[2] ?? match[3] ?? match[4]))) {
      if (line.end < 0 || match.index > line.end) {
        line = lineKey(text, match.index)
        if (line.end < 0) line.end = text.length
      }
      yield {
        index: match.index,
        length: match[0].length,
        quoted: match[3] === undefined,
        scalar: match[0].endsWith(':'),
        indent: match.index === line.key ? line.indent : 0,
        encoded: match[4] !== undefined,
        flow: match[3] === undefined && match[0].endsWith(':') && /[,{]\s*$/.test(text.slice(gapStart, match.index)),
      }
    }
  }
}

const VALUE_KINDS = {
  KEY: 'k',
  PLAIN: 'p',
  QUOTED: 'q',
  QUOTED_SCALAR: 'c',
  SCALAR: 's',
  VALUE: 'v',
  SEQUENCE: 'l',
  SEQUENCE_DASH: 'd',
  CONTAINER_END: 'f',
} as const
type ValueKind = (typeof VALUE_KINDS)[keyof typeof VALUE_KINDS]
const CREDENTIAL_WHITESPACE = {HORIZONTAL: 'horizontal', QUOTED: 'quoted', ASSIGNMENT: 'assignment'} as const
type CredentialWhitespace = (typeof CREDENTIAL_WHITESPACE)[keyof typeof CREDENTIAL_WHITESPACE]
const valueStateStart = new RegExp(String.raw`^\0r:(\d+):(${Object.values(VALUE_KINDS).join('|')}):(-|\d+);`)
type ValueState = {indent: number; kind: ValueKind; column: number | null}
function valueContext({indent, kind, column}: ValueState) {
  return `\0r:${indent}:${kind}:${column ?? '-'};`
}
function valueState(text: string) {
  const match = valueStateStart.exec(text)
  if (!match) return
  const indent = Number(match[1]),
    column = match[3] === '-' ? null : Number(match[3])
  if (!Number.isSafeInteger(indent) || (column !== null && !Number.isSafeInteger(column))) return
  return {indent, kind: match[2] as ValueState['kind'], column, length: match[0].length}
}
const sequenceItem = (text: string, cursor: number) =>
  text[cursor] === '-' && (cursor + 1 === text.length || /[ \t\r\n]/.test(text[cursor + 1]))
function escapedValueState(text: string) {
  const match = /^\0j:(\d+):(\d+);/.exec(text)
  if (!match) return
  const level = Number(match[1]),
    pending = Number(match[2])
  if (!Number.isSafeInteger(level) || level < 0 || !Number.isSafeInteger(pending)) return
  return {level, pending, length: match[0].length}
}
type ContainerState = {
  depth: number
  closing: string
  quote: string
  escaped: boolean
  indent: number
  comment: boolean
  separated: boolean
}
function containerState(text: string): ContainerState | undefined {
  const match = /^\0f:(\d+):([}\]]):(["'-]):([01]):(\d+):([01]):([01]);/.exec(text)
  if (
    !match ||
    !Number.isSafeInteger(Number(match[1])) ||
    Number(match[1]) < 1 ||
    !Number.isSafeInteger(Number(match[5]))
  )
    return
  return {
    depth: Number(match[1]),
    closing: match[2],
    quote: match[3] === '-' ? '' : match[3],
    escaped: match[4] === '1',
    indent: Number(match[5]),
    comment: match[6] === '1',
    separated: match[7] === '1',
  }
}
/** Flow containers terminate at their closing delimiter, not an indentation change. */
function containerValue(text: string, start: number, state: ContainerState) {
  const {closing, indent} = state
  let {depth, quote, escaped, comment, separated} = state
  for (let end = start; end < text.length; end++) {
    const char = text[end]
    if (comment) {
      if (char === '\r' || char === '\n') {
        comment = false
        separated = true
      }
      continue
    }
    if (quote) {
      if (char === quote && !escaped) quote = ''
      // YAML single-quoted flow strings use doubled apostrophes, not backslash escapes.
      escaped = quote === '"' && char === '\\' && !escaped
      separated = false
    } else if (char === '#' && separated) {
      comment = true
    } else if (char === '"' || char === "'") {
      quote = char
      separated = false
    } else if (char === '[' || char === '{') {
      depth++
      separated = true
    } else if (char === ']' || char === '}') {
      depth--
      if (depth === 0 && char === closing) {
        const value = assignmentValue(text, end + 1, {indent, kind: VALUE_KINDS.CONTAINER_END, column: null})
        return {...value, start}
      }
      // A mismatched outer delimiter is not a safe public sibling boundary.
      if (depth === 0) depth = 1
      separated = true
    } else separated = /[\s,:]/.test(char)
  }
  return {
    start,
    end: text.length,
    continuation: `\0f:${depth}:${closing}:${quote || '-'}:${Number(escaped)}:${indent}:${Number(comment)}:${Number(separated)};`,
  }
}
/** Encoded quote delimiters keep their level; retained state contains counters, not discarded bytes. */
function escapedValue(text: string, start: number, level: number, pending = 0) {
  for (let end = start; end < text.length; end++) {
    if (text[end] === '\\') pending++
    else {
      if (level === 0) {
        if (text[end] !== '"' || pending === 0)
          return assignmentValue(text, start, {indent: 0, kind: VALUE_KINDS.VALUE, column: null})
        level = pending
        pending = 0
        continue
      }
      if (text[end] === '"' && pending === level) return {start, end: end + 1, continuation: undefined}
      pending = 0
    }
  }
  return {start, end: text.length, continuation: `\0j:${level}:${pending};`}
}
/** Retain only indentation/phase counters, never a discarded word or block body. */
function assignmentValue(text: string, start: number, state: ValueState) {
  let cursor = start,
    end = start,
    column = state.column
  if (state.kind === VALUE_KINDS.CONTAINER_END) {
    if (cursor === text.length) return {start, end, continuation: valueContext(state)}
    // A closing bracket only ends a structured value when its next byte proves a boundary.
    // Otherwise this was a scalar prefix, and its remaining bytes are still credentials.
    if (/[,\]}\s]/.test(text[cursor])) return {start, end, continuation: undefined}
    state = {...state, kind: VALUE_KINDS.VALUE}
  }
  if (state.kind === VALUE_KINDS.SEQUENCE_DASH) {
    if (cursor === text.length) return {start, end, continuation: valueContext(state)}
    if (!/[ \t\r\n]/.test(text[cursor])) return {start, end, continuation: undefined}
    state = {...state, kind: VALUE_KINDS.SEQUENCE}
  }
  if (state.kind !== VALUE_KINDS.VALUE && state.kind !== VALUE_KINDS.SEQUENCE) {
    while (cursor < text.length && /[ \t\r\n]/.test(text[cursor])) {
      if (/[\r\n]/.test(text[cursor])) column = 0
      else if (column !== null) column++
      cursor++
    }
    if (cursor === text.length) return {start: cursor, end: cursor, continuation: valueContext({...state, column})}
    if (
      [VALUE_KINDS.SCALAR, VALUE_KINDS.QUOTED_SCALAR].some((kind) => state.kind === kind) &&
      column !== null &&
      column >= state.indent &&
      sequenceItem(text, cursor)
    )
      return assignmentValue(text, cursor, {...state, indent: column, kind: VALUE_KINDS.SEQUENCE, column})
    if (
      column !== null &&
      column <= state.indent &&
      !(
        [VALUE_KINDS.QUOTED, VALUE_KINDS.QUOTED_SCALAR].some((kind) => state.kind === kind) &&
        /["'[{]/.test(text[cursor])
      )
    )
      return {start, end: start, continuation: undefined}
    return credentialValue(
      text,
      cursor,
      true,
      false,
      CREDENTIAL_WHITESPACE.ASSIGNMENT,
      state.indent,
      state.kind !== VALUE_KINDS.PLAIN || column !== null,
    )
  }
  while (cursor < text.length) {
    const char = text[cursor]
    if (column !== null) {
      if (/[ \t]/.test(char)) {
        column++
        cursor++
        continue
      }
      if (!/[\r\n]/.test(char)) {
        if (column <= state.indent) {
          if (state.kind !== VALUE_KINDS.SEQUENCE || column !== state.indent || !sequenceItem(text, cursor))
            return {start, end, continuation: undefined}
          if (cursor + 1 === text.length)
            return {
              start,
              end: cursor,
              continuation: valueContext({...state, kind: VALUE_KINDS.SEQUENCE_DASH, column: null}),
            }
        }
        column = null
      }
    }
    if (/[\r\n]/.test(char)) column = 0
    else {
      end = cursor + 1
    }
    cursor++
  }
  return {start, end, continuation: valueContext({...state, column})}
}

function credentialValue(
  text: string,
  start: number,
  authorization = false,
  token = false,
  whitespace: CredentialWhitespace = CREDENTIAL_WHITESPACE.HORIZONTAL,
  indent = 0,
  scalar = false,
  flow = false,
): {start: number; end: number; continuation: string | undefined} {
  const original = start
  let column: number | null = null
  while (start < text.length && /[ \t\r\n]/.test(text[start])) {
    if (/[\r\n]/.test(text[start])) {
      if (whitespace === CREDENTIAL_WHITESPACE.HORIZONTAL) break
      column = 0
    } else if (column !== null) column++
    start++
  }
  if (whitespace !== CREDENTIAL_WHITESPACE.HORIZONTAL) {
    const quoted = whitespace === CREDENTIAL_WHITESPACE.QUOTED
    const kind = scalar
      ? quoted
        ? VALUE_KINDS.QUOTED_SCALAR
        : VALUE_KINDS.SCALAR
      : quoted
        ? VALUE_KINDS.QUOTED
        : VALUE_KINDS.PLAIN
    if (start === text.length) return {start, end: start, continuation: valueContext({indent, kind, column})}
    if (scalar && column !== null && column >= indent && sequenceItem(text, start))
      return assignmentValue(text, start, {indent: column, kind: VALUE_KINDS.SEQUENCE, column})
    if (column !== null && column <= indent && !(quoted && /["'[{]/.test(text[start])))
      return {start: original, end: original, continuation: undefined}
  }
  let end = start
  const completeScalar = whitespace !== CREDENTIAL_WHITESPACE.HORIZONTAL && (scalar || column !== null)
  if (authorization && !completeScalar) {
    const scheme = /^(?:Basic|Bearer)[ \t]+/i.exec(text.slice(start))
    if (scheme) {
      end += scheme[0].length
      token = true
    }
  }
  const quote = text[end]
  if (scalar && (quote === '[' || quote === '{'))
    return containerValue(text, start, {
      depth: 0,
      closing: quote === '[' ? ']' : '}',
      quote: '',
      escaped: false,
      indent,
      comment: false,
      separated: true,
    })
  const encodedQuote = /^(\\+)"/.exec(text.slice(end))
  if (encodedQuote) {
    const value = escapedValue(text, end + encodedQuote[0].length, encodedQuote[1].length)
    return {...value, start}
  }
  if (end < text.length && /^\\+$/.test(text.slice(end)))
    return {start, end: text.length, continuation: `\0j:0:${text.length - end};`}
  if (quote === '"' || quote === "'") {
    let escaped = false
    for (end++; end < text.length; end++) {
      if (quote === "'" && text[end] === quote && text[end + 1] === quote) {
        end++
        escaped = false
        continue
      }
      if (text[end] === quote && !escaped) {
        return {start, end: end + 1, continuation: quote === "'" && end + 1 === text.length ? "'x'" : undefined}
      }
      // An escaped final quote may become the first half of a YAML doubled quote.
      if (quote === "'" && text[end] === quote && escaped && end + 1 === text.length)
        return {start, end: end + 1, continuation: "'x\\'"}
      escaped = text[end] === '\\' && !escaped
    }
    return {start, end, continuation: quote + 'x' + (escaped ? '\\' : '')}
  }
  if (flow) {
    // Typed JSON scalars end before sibling fields, unlike free-form credentials.
    const primitive =
      /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)(?=\s*(?:}|,\s*"(?:\\.|[^"\\\r\n])*"\s*:))/.exec(
        text.slice(start),
      )
    if (primitive) return {start, end: start + primitive[0].length, continuation: undefined}
  }
  if (!token && completeScalar) return assignmentValue(text, start, {indent, kind: VALUE_KINDS.VALUE, column: null})
  while (end < text.length && (token ? /[a-z\d._~+/=-]/i.test(text[end]) : !/\s/.test(text[end]))) end++
  return {start, end, continuation: end === text.length ? (end > start ? 'x' : '') : undefined}
}

/** Keep quote/key syntax and keyword states, never an arbitrary discarded value. */
function quotedKeyContext(text: string) {
  if (!text.includes('"') && !text.includes("'")) return
  let quote = '',
    start = 0,
    escaped = false,
    separator = false,
    closed: {quote: string; name: string; index: number} | undefined
  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    // An evicted enclosing string must not steal the next JSON member's key origin.
    if (separator && char === quote && !credentialQueryKey(assignmentKey(text.slice(start, index)))) {
      quote = ''
      escaped = false
    }
    if (!quote) {
      // An encoded delimiter is not the origin of an ordinary quoted key.
      if ((char === '"' || char === "'") && text[index - 1] !== '\\') {
        quote = char
        start = index + 1
        closed = undefined
      } else if (!/[ \t\r\n]/.test(char)) closed = undefined
    } else if (char === quote && !escaped) {
      closed = {quote, name: text.slice(start, index), index: start - 1}
      quote = ''
    } else escaped = char === '\\' && !escaped
    if (char === ',' || char === '{') separator = true
    else if (separator && !/[ \t\r\n]/.test(char)) separator = false
  }
  if (!quote)
    return closed && credentialQueryKey(assignmentKey(closed.name))
      ? {syntax: `${closed.quote}secret${closed.quote}`, index: closed.index}
      : undefined
  const name = text.slice(start)
  const encoding = finalMatch(name, /\\(?:u[a-f\d]{0,3})?$/i)?.[0] ?? finalMatch(name, /%[a-f\d]?$/i)?.[0] ?? ''
  const decoded = credentialName(assignmentKey(encoding ? name.slice(0, -encoding.length) : name))
  if (credentialQueryKey(decoded, false)) return {syntax: quote + 'secret', index: start - 1}
  let partial = ''
  for (const key of queryKeys)
    for (let size = key.length; size > partial.length; size--)
      if (decoded.endsWith(key.slice(0, size))) {
        partial = key.slice(0, size)
        break
      }
  return {syntax: quote + (decoded.length > partial.length ? 'q' : '') + partial + encoding, index: start - 1}
}

function escapedKeyContext(text: string) {
  const closed = finalMatch(text, /(?<!\\)\\+"([^"\r\n]*?)(?<!\\)\\+"[ \t\r\n]*$/)
  if (closed && credentialQueryKey(assignmentKey(closed[1]))) return {syntax: '\\"secret\\"', index: closed.index}
  const open = finalMatch(text, /(?<!\\)\\+"([^"\r\n]*)$/)
  if (!open) return
  const pending = /\\+$/.exec(open[1])?.[0] ?? ''
  const key = quotedKeyContext('"' + open[1].slice(0, open[1].length - pending.length))
  return key ? {syntax: key.syntax.replaceAll('"', '\\"') + (pending ? '\\' : ''), index: open.index} : undefined
}

function lastCredentialQuerySuffix(text: string): string {
  queryStart.lastIndex = 0
  let start = -1
  for (let match = queryStart.exec(text); match; match = queryStart.exec(text))
    if (credentialQueryKey(match[1])) start = match.index
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
export const REDACTION_VIEWS = {RAW: 'raw', VISIBLE: 'visible'} as const
export type RedactionView = (typeof REDACTION_VIEWS)[keyof typeof REDACTION_VIEWS]

/** Project ordered spans through monotonic UTF-16 segments, accounting for independent view eviction. */
export function projectRedactionSpans(
  spans: readonly RedactionSpan[],
  segments: readonly RedactionSegment[],
  from: RedactionView,
  to: RedactionView,
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
  const firstLine = lineKey(text, 0)
  const add = (start: number, end: number) => {
    spans.push({start, end})
  }
  let continuedEnd = 0,
    firstIndent = 0,
    continuedQueryEnd = 0
  for (const prefix of options.credentialPrefixes ?? []) {
    const container = containerState(prefix)
    if (container) continuedEnd = Math.max(continuedEnd, containerValue(text, 0, container).end)
    const escaped = escapedValueState(prefix)
    if (escaped) continuedEnd = Math.max(continuedEnd, escapedValue(text, 0, escaped.level, escaped.pending).end)
    if (/^[?&#]/.test(prefix)) {
      const input = prefix + text
      queryStart.lastIndex = 0
      const match = queryStart.exec(input)
      if (match && match.index < prefix.length && credentialQueryKey(match[1])) {
        let end = match.index + match[0].length
        while (end < input.length && !/[&#\s]/.test(input[end])) end++
        continuedQueryEnd = Math.max(continuedQueryEnd, end - prefix.length)
      }
    }
    const state = valueState(prefix)
    if (!state) continue
    if (state.kind === VALUE_KINDS.KEY) {
      const syntax = prefix.slice(state.length)
      firstIndent = Math.max(firstIndent, state.indent + lineKey(syntax + text, 0).indent)
    } else continuedEnd = Math.max(continuedEnd, assignmentValue(text, 0, state).end)
  }
  for (const span of options.spans ?? []) add(span.start, span.end)
  for (const prefix of ['', ...(options.credentialPrefixes ?? [])]) {
    const container = containerState(prefix)
    if (container) {
      const value = containerValue(text, 0, container)
      add(value.start, value.end)
      continue
    }
    const escaped = escapedValueState(prefix)
    if (escaped) {
      const value = escapedValue(text, 0, escaped.level, escaped.pending)
      add(value.start, value.end)
      continue
    }
    const state = valueState(prefix)
    if (state && state.kind !== VALUE_KINDS.KEY && state.length === prefix.length) {
      const value = assignmentValue(text, 0, state)
      add(value.start, value.end)
      continue
    }
    const credentialPrefix = state?.kind === VALUE_KINDS.KEY ? prefix.slice(state.length) : prefix
    const credentialText = credentialPrefix + text
    const firstCredentialLine = credentialPrefix ? lineKey(credentialText, 0) : firstLine
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
      if (continuedEnd > 0 && match.index - credentialPrefix.length < continuedEnd) continue
      const value = credentialValue(credentialText, match.index + match[0].length, false, true)
      covered = value.end
      add(value.start - credentialPrefix.length, value.end - credentialPrefix.length)
    }
    covered = -1
    for (const match of credentialAssignments(credentialText)) {
      if (match.index < covered) continue
      if (continuedEnd > 0 && match.index - credentialPrefix.length < continuedEnd) continue
      // An evicted query prefix still owns its value's delimiter rules. An
      // unprefixed assignment recognizer must not consume the public next parameter.
      if (continuedQueryEnd > 0 && match.index - credentialPrefix.length < continuedQueryEnd) continue
      if (!credentialPrefix && match.index === 0 && options.credentialPrefixes?.includes('_')) continue
      const value = credentialValue(
        credentialText,
        match.index + match.length,
        true,
        false,
        match.quoted ? CREDENTIAL_WHITESPACE.QUOTED : CREDENTIAL_WHITESPACE.ASSIGNMENT,
        state?.kind === VALUE_KINDS.KEY && match.index === firstCredentialLine.key
          ? state.indent + match.indent
          : match.index - credentialPrefix.length === firstLine.key
            ? Math.max(firstIndent, match.indent)
            : match.indent,
        match.scalar,
        match.flow,
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
export function maskRedactionSpans(
  text: string,
  spans: readonly RedactionSpan[],
  clean: (value: string) => string = (value) => value,
) {
  const merged = mergeSpans(spans, text.length)
  let result = '',
    cursor = 0
  for (const span of merged) {
    result += clean(text.slice(cursor, span.start)) + '[redacted]'
    cursor = span.end
  }
  return {text: result + clean(text.slice(cursor)), spans: merged}
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
  if (/[\u0018\u001a\u001b\u0090\u0098\u009b-\u009f]/.test(text)) {
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
function discardedContext(discarded: string): string[] {
  const contexts = new Set<string>()
  const escaped = escapedValueState(discarded)
  if (escaped) {
    discarded = discarded.slice(escaped.length)
    const value = escapedValue(discarded, 0, escaped.level, escaped.pending)
    if (value.continuation) contexts.add(value.continuation)
  }
  const state = valueState(discarded)
  const retainValue = (continuation: string | undefined, quoted: boolean) => {
    if (continuation !== undefined)
      contexts.add(
        valueState(continuation) || escapedValueState(continuation) || containerState(continuation)
          ? continuation
          : (quoted ? '"secret":' : 'secret=') + continuation,
      )
  }
  if (state) {
    discarded = discarded.slice(state.length)
    if (state.kind !== VALUE_KINDS.KEY) retainValue(assignmentValue(discarded, 0, state).continuation, false)
  }
  const retainKey = (syntax: string, index: number) => {
    const line = lineKey(discarded, index)
    const indent =
      index === line.key
        ? line.indent +
          (state?.kind === VALUE_KINDS.KEY && !/[\r\n]/.test(discarded.slice(0, index)) ? state.indent : 0)
        : 0
    contexts.add((indent ? valueContext({indent, kind: VALUE_KINDS.KEY, column: null}) : '') + syntax)
  }
  if (finalMatch(lastCredentialQuerySuffix(discarded), /^[?&#][^?&#=\s]+=[^&#\s]*$/)) contexts.add('?token=x')
  const queryName = unfinishedQueryName(discarded)
  const pendingQuery = queryName ? finalMatch(discarded, /[?&#]([^?&#=\s]*)$/)?.index : undefined
  if (queryName) contexts.add(queryName)
  let covered = -1
  for (const match of discarded.matchAll(authStart)) {
    if (match.index < covered) continue
    const value = credentialValue(discarded, match.index + match[0].length, false, true)
    covered = value.end
    if (value.continuation !== undefined) contexts.add('Bearer ' + value.continuation)
  }
  covered = -1
  const firstLineKey = lineKey(discarded, 0).key
  for (const match of credentialAssignments(discarded)) {
    if (match.index < covered) continue
    if (pendingQuery !== undefined && match.index >= pendingQuery) continue
    const value = credentialValue(
      discarded,
      match.index + match.length,
      true,
      false,
      match.quoted ? CREDENTIAL_WHITESPACE.QUOTED : CREDENTIAL_WHITESPACE.ASSIGNMENT,
      state?.kind === VALUE_KINDS.KEY && match.index === firstLineKey ? state.indent + match.indent : match.indent,
      match.scalar,
      match.flow,
    )
    covered = value.end
    retainValue(value.continuation, match.quoted)
  }
  const quotedKey = quotedKeyContext(discarded)
  const encodedKey = escapedKeyContext(discarded)
  if (quotedKey && !encodedKey && pendingQuery === undefined) retainKey(quotedKey.syntax, quotedKey.index)
  if (encodedKey && pendingQuery === undefined) retainKey(encodedKey.syntax, encodedKey.index)
  if (discarded.endsWith('\\')) contexts.add('\\')
  // The escape's letter is not the start of a word; keep the boundary for a key in the next chunk.
  const whitespaceEscape = finalMatch(discarded, /\\[nrt]$/)?.[0]
  if (whitespaceEscape) contexts.add(whitespaceEscape)
  const pendingName = finalMatch(discarded, /(?:(?<![a-z\d_.%+\\-])|(?<=(?-i:\\[nrt])))([a-z_%][a-z\d_.%+-]*)[ \t]*$/i)
  // Whitespace completes an exact alias; without it, "sig" may still become "signal".
  if (pendingName && pendingQuery === undefined && credentialQueryKey(pendingName[1], /[ \t]$/.test(discarded)))
    retainKey('secret', pendingName.index)
  if (finalMatch(discarded, /(?<![a-z\d+.-])[a-z][a-z\d+.-]*:\/\/[^\s/?#]*$/i)) contexts.add('https://')
  let partial = ''
  const encoding = finalMatch(discarded, /%[a-f\d]?$/i)?.[0] ?? ''
  const lower = credentialName(encoding ? discarded.slice(0, -encoding.length) : discarded)
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
  const partialStart = discarded.length - partial.length - encoding.length
  const midWord =
    /[a-z\d_.%+-]/i.test(lower.at(-partial.length - 1) ?? '') && !/\\[nrt]$/.test(discarded.slice(0, partialStart))
  if ((partial || encoding) && pendingQuery === undefined)
    retainKey((midWord ? 'q' : '') + partial + encoding, Math.max(0, partialStart))
  const trailingLine = discarded.slice(Math.max(discarded.lastIndexOf('\n'), discarded.lastIndexOf('\r')) + 1)
  if (trailingLine && /^[ \t]*(?:-[ \t]+)*-?$/.test(trailingLine)) {
    const line = lineKey(discarded, discarded.length)
    const indent = line.indent + (state?.kind === VALUE_KINDS.KEY && !/[\r\n]/.test(discarded) ? state.indent : 0)
    contexts.add(valueContext({indent, kind: VALUE_KINDS.KEY, column: null}) + discarded.slice(line.key))
  }
  const scheme = finalMatch(discarded, /(?<![a-z\d+.-])[a-z][a-z\d+.-]*:(\/?)$/i)
  if (scheme) contexts.add(`https:${scheme[1]}`)
  // A partial URI scheme can coexist with another recognizer, such as Bearer.
  if (finalMatch(discarded, /[a-z\d+.-]$/i)) contexts.add('x')
  // A raw tail starting mid-name cannot establish a fresh exact short alias.
  if (finalMatch(discarded, /[a-z\d_.%+-]$/i)) contexts.add('_')
  return [...contexts]
}

/** Advance concurrent recognizers without retaining duplicate origins of the same current-line syntax. */
export function redactionContext(discarded: string, prefixes: readonly string[] = []): string[] {
  const containers = prefixes.map(containerState).filter((state) => state !== undefined)
  if (containers.length) {
    const values = containers.map((state) => containerValue(discarded, 0, state))
    const continuing = values.flatMap(({continuation}) => (continuation ? [continuation] : []))
    // Do not invent fresh key origins inside a credential container's discarded body.
    if (continuing.length) return [...new Set(continuing)]
    return redactionContext(discarded.slice(Math.max(...values.map(({end}) => end))))
  }
  const contexts = new Set<string>()
  const keys = new Map<string, {indent: number; context: string}>()
  const escapedBoundary = prefixes.includes('\\') && discarded.startsWith('"')
  for (const prefix of ['', ...prefixes]) {
    // Do not reinterpret a split encoded quote as a fresh, ordinary key delimiter.
    const boundary = escapedBoundary && !prefix.endsWith('\\') && !escapedValueState(prefix) ? '\\' : ''
    for (const context of discardedContext(prefix + boundary + discarded)) {
      const state = valueState(context)
      if (state?.kind !== VALUE_KINDS.KEY) {
        contexts.add(context)
        continue
      }
      const syntax = context.slice(state.length)
      // A fresh suffix of an already observed whitespace line is not another
      // indentation origin. Keep the complete observed column for this syntax.
      if (!keys.has(syntax) || keys.get(syntax)!.indent < state.indent)
        keys.set(syntax, {indent: state.indent, context})
    }
  }
  return [...contexts, ...[...keys.values()].map(({context}) => context)]
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
