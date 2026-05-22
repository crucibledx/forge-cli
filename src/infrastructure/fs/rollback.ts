import {existsSync} from 'node:fs'
import {mkdir, rmdir, unlink, writeFile} from 'node:fs/promises'
import {dirname, isAbsolute, join} from 'node:path'

import {MUTATION_TYPES} from '@domain/sync/types'

import type {AppliedMutation} from './mutations'

export async function rollbackMutations(projectRoot: string, applied: AppliedMutation[]): Promise<void> {
  // Rollback in reverse order
  for (const entry of [...applied].reverse()) {
    if (!entry.success) continue

    const resolve = (p: string) => (isAbsolute(p) ? p : join(projectRoot, p))

    try {
      switch (entry.mutation.type) {
        case MUTATION_TYPES.FILE_WRITE: {
          const target = resolve(entry.mutation.path)
          if (entry.previousContent !== undefined) {
            await writeFile(target, entry.previousContent, 'utf-8')
          } else if (existsSync(target)) {
            await unlink(target)
          }
          break
        }

        case MUTATION_TYPES.FILE_DELETE: {
          if (entry.previousContent !== undefined) {
            const target = resolve(entry.mutation.path)
            await mkdir(dirname(target), {recursive: true})
            await writeFile(target, entry.previousContent, 'utf-8')
          }
          break
        }

        case MUTATION_TYPES.DIR_CREATE: {
          const target = resolve(entry.mutation.path)
          if (existsSync(target)) {
            try {
              await rmdir(target) // only removes if empty
            } catch {
              // not empty — leave it
            }
          }
          break
        }

        case MUTATION_TYPES.SYMLINK_CREATE: {
          const target = resolve(entry.mutation.path)
          if (existsSync(target)) {
            await unlink(target)
          }
          break
        }
      }
    } catch {
      // best-effort rollback — don't throw
    }
  }
}
