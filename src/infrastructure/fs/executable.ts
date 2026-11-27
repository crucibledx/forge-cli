/**
 * True when `name` resolves to a runnable executable on PATH, via the runtime's own resolver (PATHEXT-aware
 * on Windows; name matches that are directories or non-executable files do not resolve). Sync uses it for
 * prerequisites of the files it delivers, such as the interpreter a generated Droid hook spawns.
 */
export function executableOnPath(name: string): boolean {
  return Bun.which(name) !== null
}
