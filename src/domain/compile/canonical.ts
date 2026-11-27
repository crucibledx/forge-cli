/** Canonical JSON (spec 0005 §5): sorted object keys at every depth, no insignificant whitespace. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, v]) => `${JSON.stringify(key)}:${canonicalJson(v)}`)
  return `{${entries.join(',')}}`
}

/** Canonical JSON document: the canonical value plus a trailing newline. */
export const canonicalDocument = (value: unknown): string => `${canonicalJson(value)}\n`
