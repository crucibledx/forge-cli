import {portablePath} from '../portable-path'

export {CONFIG_PATH, STATE_PATH} from '../config/paths'

/** Source precedence is exact-spelling only; portable aliases never gain precedence. */
export function validatePathGraph(paths: string[]): void {
  const keys = new Map<string, string>()
  const directories = new Map<string, string>()
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
    const segments = path.replaceAll('\\', '/').split('/').filter(Boolean)
    for (let i = 1; i < segments.length; i++) {
      const directory = segments.slice(0, i).join('/')
      const directoryKey = portablePath(directory)
      const previousDirectory = directories.get(directoryKey)
      if (previousDirectory !== undefined && previousDirectory !== directory)
        throw new Error(`Competing or aliased directories: "${previousDirectory}" and "${directory}"`)
      directories.set(directoryKey, directory)
    }
  }
  for (const [key, path] of keys) {
    const segments = key.split('/')
    for (let i = 1; i < segments.length; i++) {
      const ancestor = segments.slice(0, i).join('/')
      if (keys.has(ancestor)) throw new Error(`File/directory collision: "${keys.get(ancestor)}" and "${path}"`)
    }
  }
}
