export {CONFIG_PATH, STATE_PATH} from '../config/paths'

export function portablePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/\/+/g, '/').normalize('NFC').toLowerCase().replace(/\/+$/, '')
}

/** Source precedence is exact-spelling only; portable aliases never gain precedence. */
export function validatePathGraph(paths: string[]): void {
  const keys = new Map<string, string>()
  for (const path of paths) {
    if (
      !path ||
      /^(?:[/\\]|[a-z]:)/i.test(path) ||
      path.includes('\0') ||
      path.split(/[/\\]/).some((segment) => segment === '..' || segment === '.')
    )
      throw new Error(`Unsafe planned path: "${path}"`)
    const key = portablePath(path)
    const previous = keys.get(key)
    if (previous !== undefined) throw new Error(`Competing or aliased paths: "${previous}" and "${path}"`)
    keys.set(key, path)
  }
  for (const [key, path] of keys) {
    const segments = key.split('/')
    for (let i = 1; i < segments.length; i++) {
      const ancestor = segments.slice(0, i).join('/')
      if (keys.has(ancestor)) throw new Error(`File/directory collision: "${keys.get(ancestor)}" and "${path}"`)
    }
  }
}
