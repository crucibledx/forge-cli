export function propertyOptions(env: Record<string, string | undefined>) {
  const text = env.FC_SEED ?? '20261104'
  const seed = Number(text)
  if (!/^-?\d+$/.test(text) || !Number.isSafeInteger(seed) || seed < -2147483648 || seed > 2147483647) {
    throw new Error('FC_SEED must be a signed 32-bit integer; unset it to use seed 20261104.')
  }
  const path = env.FC_PATH ?? ''
  if (path && !/^\d+(?::\d+)*$/.test(path))
    throw new Error('FC_PATH must be an empty string or numeric colon-separated fast-check replay path.')
  return {numRuns: 100, seed, ...(path ? {path} : {})}
}
