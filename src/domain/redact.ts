const queryKeys = ['access_token', 'token', 'password', 'secret', 'key', 'auth']
const queryMarker = `[?&#](?:${queryKeys.join('|')})=`
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

interface RedactionOptions {
  secrets?: readonly string[]
  credentialPrefixes?: readonly string[]
  secretPrefix?: string
  assignments?: boolean
}
interface RedactionSpan {
  start: number
  end: number
}

/** Recognize every span against unchanged input, then mask their union. */
export function redact(text: string, options: RedactionOptions = {}): string {
  const spans: RedactionSpan[] = []
  const add = (start: number, end: number) => {
    start = Math.max(0, start)
    end = Math.min(text.length, end)
    if (start < end) spans.push({start, end})
  }
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
  spans.sort((a, b) => a.start - b.start || a.end - b.end)
  const merged: RedactionSpan[] = []
  for (const span of spans) {
    const previous = merged.at(-1)
    if (previous && span.start <= previous.end) previous.end = Math.max(previous.end, span.end)
    else merged.push({...span})
  }
  let result = '',
    cursor = 0
  for (const span of merged) {
    result += text.slice(cursor, span.start) + '[redacted]'
    cursor = span.end
  }
  return result + text.slice(cursor)
}
/** Finite syntax-only contexts for concurrent recognizers. Never publish these. */
export function redactionContext(discarded: string): string[] {
  const contexts = new Set<string>()
  if (unfinishedQuery.test(lastMarkerSuffix(discarded, queryStart))) contexts.add('?token=')
  const queryName = /[?&#]([a-z_]*)$/i.exec(discarded)
  if (queryName && queryKeys.some((key) => key.startsWith(queryName[1].toLowerCase())))
    contexts.add(queryName[0].toLowerCase())
  if (/Bearer\s+[a-z\d._~+/-]*=*$/i.test(discarded)) contexts.add('Bearer ')
  if (/^(?:token|password|secret|authorization)[=:]\s*[^\s&]*$/i.test(lastMarkerSuffix(discarded, assignmentStart)))
    contexts.add('secret=')
  if (/(?<![a-z\d+.-])[a-z][a-z\d+.-]*:\/\/[^\s/]*$/i.test(discarded)) contexts.add('https://')
  let partial = ''
  for (const marker of [
    'Bearer',
    'access_token=',
    'token=',
    'password=',
    'secret=',
    'key=',
    'auth=',
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
  const scheme = /(?<![a-z\d+.-])[a-z][a-z\d+.-]*:(\/?)$/i.exec(discarded)
  if (scheme) contexts.add(`https:${scheme[1]}`)
  if (!contexts.size && /[a-z\d+.-]$/i.test(discarded)) contexts.add('x')
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
