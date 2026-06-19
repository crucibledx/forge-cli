import {existsSync} from 'node:fs'
import {mkdir, rmdir, unlink, writeFile} from 'node:fs/promises'
import {dirname} from 'node:path'

import {MUTATION_TYPES} from '@domain/sync/types'

import type {AppliedMutation} from './mutations'
import {safeResolve} from './mutations'

type RollbackHandler = (root: string, entry: AppliedMutation) => Promise<void>

const rollbackHandlers: Record<string, RollbackHandler> = {
  [MUTATION_TYPES.FILE_WRITE]: async (root, entry) => {
    const target = safeResolve(root, entry.mutation.path)
    if (entry.previousContent !== undefined) {
      await writeFile(target, entry.previousContent, 'utf-8')
    } else if (existsSync(target)) {
      await unlink(target)
    }
  },

  [MUTATION_TYPES.FILE_DELETE]: async (root, entry) => {
    if (entry.previousContent !== undefined) {
      const target = safeResolve(root, entry.mutation.path)
      await mkdir(dirname(target), {recursive: true})
      await writeFile(target, entry.previousContent, 'utf-8')
    }
  },

  [MUTATION_TYPES.DIR_CREATE]: async (root, entry) => {
    const target = safeResolve(root, entry.mutation.path)
    if (existsSync(target)) {
      try {
        await rmdir(target) // only removes if empty
      } catch {
        // not empty — leave it
      }
    }
  },

  [MUTATION_TYPES.SYMLINK_CREATE]: async (root, entry) => {
    const target = safeResolve(root, entry.mutation.path)
    if (existsSync(target)) {
      await unlink(target)
    }
  },
}

export async function rollbackMutations(projectRoot: string, applied: AppliedMutation[]): Promise<void> {
  // Rollback in reverse order
  for (const entry of [...applied].reverse()) {
    if (!entry.success) continue

    try {
      const handler = rollbackHandlers[entry.mutation.type]
      if (handler) await handler(projectRoot, entry)
    } catch {
      // best-effort rollback — don't throw
    }
  }
}
