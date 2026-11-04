import {lstat, realpath} from 'node:fs/promises'
import {isAbsolute, relative, resolve, sep, win32} from 'node:path'

export class ConfinementError extends Error {
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

export async function createConfinement(selectedRoot: string) {
  const selected = resolve(selectedRoot)
  const root = await realpath(selected)
  if (!(await lstat(root)).isDirectory()) throw new ConfinementError(selectedRoot, 'root is not a directory')
  return {
    root,
    async resolve(path: string): Promise<string> {
      if (!path || path.includes('\0')) throw new ConfinementError(path, 'invalid filename')
      if (/^[a-z]:(?![/\\])/i.test(path)) throw new ConfinementError(path, 'drive-relative path')
      if (
        process.platform !== 'win32' &&
        ((win32.isAbsolute(path) && !isAbsolute(path)) || /^[a-z]:/i.test(path) || /^[/\\]{2}/.test(path))
      ) {
        throw new ConfinementError(path, 'foreign absolute or drive-relative path')
      }
      const portable = path.replaceAll('\\', sep).replaceAll('/', sep)
      if (portable.split(sep).includes('..')) throw new ConfinementError(path, 'parent traversal')
      let rel: string
      if (isAbsolute(portable)) {
        try {
          rel = inside(selected, resolve(portable))
        } catch {
          rel = inside(root, resolve(portable))
        }
      } else rel = inside(root, resolve(root, portable))
      const segments = rel.split(sep)
      if (
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
