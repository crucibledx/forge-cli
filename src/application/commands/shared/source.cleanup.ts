import {existsSync} from 'node:fs'
import {unlink} from 'node:fs/promises'
import {join} from 'node:path'

import type {SyncState} from '@domain/sync/state'

// ─── Query ──────────────────────────────────────────────────────────────────

export function getFilesForSource(state: SyncState, sourceName: string): string[] {
  return Object.entries(state.files)
    .filter(([, e]) => e.sourceName === sourceName)
    .map(([path]) => path)
}

export function countFilesForSource(state: SyncState, sourceName: string): number {
  return Object.values(state.files).filter((e) => e.sourceName === sourceName).length
}

// ─── Mutation ───────────────────────────────────────────────────────────────

export function removeSourceFromState(state: SyncState, sourceName: string): SyncState {
  const files = {...state.files}
  for (const [path, entry] of Object.entries(files)) {
    if (entry.sourceName === sourceName) delete files[path]
  }
  return {...state, files}
}

export async function deleteSourceFiles(
  projectRoot: string,
  filePaths: string[],
): Promise<{cleaned: number; errors: number}> {
  let cleaned = 0
  let errors = 0

  for (const filePath of filePaths) {
    const absPath = join(projectRoot, filePath)
    try {
      if (existsSync(absPath)) await unlink(absPath)
      cleaned++
    } catch {
      errors++
    }
  }

  return {cleaned, errors}
}
