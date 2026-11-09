import {lstat, readlink, realpath} from 'node:fs/promises'
import {dirname, isAbsolute, relative, resolve, sep, win32} from 'node:path'

class ConfinementError extends Error {
  constructor(path: string, reason: string) {
    super(`Unsafe path "${path}": ${reason}`)
    this.name = 'ConfinementError'
  }
}

function inside(root: string, path: string): string {
  const rel = relative(root, path)
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new ConfinementError(path, 'outside the selected root or root used as a file')
  }
  return rel
}

async function canonicalRoot(selected: string): Promise<string> {
  if (process.platform === 'win32' || !selected.includes('\\')) return realpath(selected)
  // Bun 1.4.2's realpath normalizes literal POSIX backslashes. Resolve native
  // components instead, retaining symlink-root support and a bounded link count.
  let current = '/',
    pending = selected.split('/'),
    links = 0
  while (pending.length) {
    const segment = pending.shift()!
    if (!segment || segment === '.') continue
    if (segment === '..') {
      current = dirname(current)
      continue
    }
    const next = resolve(current, segment)
    const info = await lstat(next)
    if (info.isSymbolicLink()) {
      if (++links > 40) throw new ConfinementError(selected, 'too many symbolic links in selected root')
      const target = await readlink(next)
      if (isAbsolute(target)) current = '/'
      pending = [...target.split('/'), ...pending]
    } else {
      if (pending.length && !info.isDirectory())
        throw new ConfinementError(selected, 'root ancestor is not a directory')
      current = next
    }
  }
  return current
}

export async function createConfinement(selectedRoot: string) {
  const selected = resolve(selectedRoot)
  const root = await canonicalRoot(selected)
  if (!(await lstat(root)).isDirectory()) throw new ConfinementError(selectedRoot, 'root is not a directory')
  return {
    root,
    async resolve(path: string): Promise<string> {
      if (!path || path.includes('\0')) throw new ConfinementError(path, 'invalid filename')
      if ((process.platform === 'win32' ? path.split(/[/\\]/) : path.split('/')).includes('..'))
        throw new ConfinementError(path, 'parent traversal')
      if (/^[a-z]:(?![/\\])/i.test(path)) throw new ConfinementError(path, 'drive-relative path')
      if (
        process.platform !== 'win32' &&
        ((win32.isAbsolute(path) && !isAbsolute(path)) || /^[a-z]:/i.test(path) || /^[/\\]{2}/.test(path))
      ) {
        throw new ConfinementError(path, 'foreign absolute or drive-relative path')
      }
      let local = path
      if (isAbsolute(path)) {
        try {
          local = inside(selected, resolve(path))
        } catch {
          local = inside(root, resolve(path))
        }
      }
      // Normalize descendants, never the native spelling of the selected root.
      const portable = local.replaceAll('\\', sep).replaceAll('/', sep)
      if (portable.split(sep).includes('..')) throw new ConfinementError(path, 'parent traversal')
      const rel = inside(root, resolve(root, portable))
      const segments = rel.split(sep)
      if (
        process.platform === 'win32' &&
        segments.some(
          (segment) =>
            /[:]/.test(segment) ||
            /[. ]$/.test(segment) ||
            /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment),
        )
      ) {
        throw new ConfinementError(path, 'non-portable filename or alternate data stream')
      }
      let current = root
      for (let i = 0; i < segments.length; i++) {
        current = resolve(current, segments[i])
        try {
          const info = await lstat(current)
          if (info.isSymbolicLink()) throw new ConfinementError(path, 'symlink/reparse point below root')
          if (i < segments.length - 1 && !info.isDirectory())
            throw new ConfinementError(path, 'ancestor is not a directory')
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        }
      }
      return resolve(root, rel)
    },
  }
}
