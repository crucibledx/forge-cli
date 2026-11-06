/** Presentation-only redaction. Never serialize upstream file contents as diagnostics. */
export function redact(text: string): string {
  // Start only at a scheme boundary, avoiding repeated scans of long invalid tokens.
  return text
    .replace(/(?<![a-z\d+.-])([a-z][a-z\d+.-]*:\/\/)[^\s/]+@/gi, '$1[redacted]@')
    .replace(/([?&#](?:access_token|token|password|secret|key|auth)=)[^&#\s"']+/gi, '$1[redacted]')
    .replace(/(Bearer\s+)[a-z\d._~+/-]+=*/gi, '$1[redacted]')
}

/** Bounded recognizer context when a diagnostic tail discards an unfinished credential. Never publish this. */
export function redactionContext(discarded: string, secrets: string[] = []): string {
  for (const secret of secrets) {
    for (let size = Math.min(secret.length - 1, discarded.length); size > 0; size--)
      if (discarded.endsWith(secret.slice(0, size))) return secret.slice(0, size)
  }
  if (/[?&#](?:access_token|token|password|secret|key|auth)=[^&#\s"']*$/i.test(discarded)) return '?token='
  if (/Bearer\s+[a-z\d._~+/-]*=*$/i.test(discarded)) return 'Bearer '
  if (/(?:token|password|secret|authorization)[=:]\s*[^\s&]*$/i.test(discarded)) return 'secret='
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
