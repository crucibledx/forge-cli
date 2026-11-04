/** Presentation-only redaction. Never serialize upstream file contents as diagnostics. */
export function redact(text: string): string {
  // Start only at a scheme boundary, avoiding repeated scans of long invalid tokens.
  return text
    .replace(/(?<![a-z\d+.-])([a-z][a-z\d+.-]*:\/\/)[^\s/]+@/gi, '$1[redacted]@')
    .replace(/([?&#](?:access_token|token|password|secret|key|auth)=)[^&#\s"']+/gi, '$1[redacted]')
    .replace(/(Bearer\s+)[a-z\d._~+/-]+=*/gi, '$1[redacted]')
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
