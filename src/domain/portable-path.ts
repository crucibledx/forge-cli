/** Portable identity for ownership/collision comparisons, not path confinement or state-key migration. */
export function portablePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/\/+/g, '/').normalize('NFC').toLowerCase().replace(/\/+$/, '')
}
