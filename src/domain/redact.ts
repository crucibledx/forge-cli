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

/** Presentation-only redaction. Never serialize upstream file contents as diagnostics. */
export function redact(text: string): string {
  // Start only at a scheme boundary, avoiding repeated scans of long invalid tokens.
  return text
    .replace(/(?<![a-z\d+.-])([a-z][a-z\d+.-]*:\/\/)[^\s/]+@/gi, '$1[redacted]@')
    .replace(queryValue, '$1[redacted]')
    .replace(/(Bearer\s+)[a-z\d._~+/-]+=*/gi, '$1[redacted]')
}

/** Bounded recognizer context when a diagnostic tail discards an unfinished credential. Never publish this. */
export function redactionContext(discarded: string, secrets: string[] = []): string {
  for (const secret of secrets) {
    for (let size = Math.min(secret.length - 1, discarded.length); size > 0; size--)
      if (discarded.endsWith(secret.slice(0, size))) return secret.slice(0, size)
  }
  // Only the final matching marker can have an unfinished value. Searching all
  // overlapping suffixes makes repeated markers quadratic during stream drains.
  if (unfinishedQuery.test(lastMarkerSuffix(discarded, queryStart))) return '?token='
  // A partial name still needs its query delimiter after the original URL is gone.
  const queryName = /[?&#]([a-z_]*)$/i.exec(discarded)
  if (queryName && queryKeys.some((key) => key.startsWith(queryName[1].toLowerCase()))) return queryName[0]
  if (/Bearer\s+[a-z\d._~+/-]*=*$/i.test(discarded)) return 'Bearer '
  if (/^(?:token|password|secret|authorization)[=:]\s*[^\s&]*$/i.test(lastMarkerSuffix(discarded, assignmentStart)))
    return 'secret='
  if (/(?<![a-z\d+.-])[a-z][a-z\d+.-]*:\/\/[^\s/]*$/i.test(discarded)) return 'https://'
  // Carry syntax, never an arbitrary discarded raw tail that could revive a
  // credential fragment. This also bridges a cut inside "Bear" / "er value".
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
    for (let size = marker.length - 1; size > 0; size--)
      if (discarded.toLowerCase().endsWith(marker.slice(0, size).toLowerCase())) return discarded.slice(-size)
  }
  const scheme = /(?<![a-z\d+.-])[a-z][a-z\d+.-]*:(\/?)$/i.exec(discarded)
  if (scheme) return `https:${scheme[1]}`
  // A cut within a very long scheme may leave only digits before "://".
  return /[a-z\d+.-]$/i.test(discarded) ? 'x' : ''
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
