/** Portable identity for ownership/collision comparisons, not path confinement or state-key migration. */
export function portablePath(path: string): string {
  // Native caseless filesystems also equate final sigma, long s and expanding case pairs.
  // This conservative key never changes the actual destination spelling or persisted state keys.
  return path
    .replaceAll('\\', '/')
    .replace(/\/+/g, '/')
    .normalize('NFC')
    .toLowerCase()
    .toUpperCase()
    .toLowerCase()
    .normalize('NFC')
    .replace(/\/+$/, '')
}
