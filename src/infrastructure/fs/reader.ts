import {readdir, readFile} from 'node:fs/promises'
import {join, relative, sep} from 'node:path'

import {getAllHarnesses} from '@domain/harnesses'
import type {SyncState} from '@domain/sync/state'
import type {SourceFile} from '@domain/sync/types'

import {createConfinement} from './confinement'

function getKnownHarnessDirs(): Set<string> {
  const dirs = new Set<string>()
  for (const harness of getAllHarnesses()) {
    for (const mapping of harness.targetMappings) {
      const topDir = mapping.destination.project.split('/')[0]
      if (topDir) dirs.add(topDir)
    }
  }
  return dirs
}

export async function collectFiles(baseDir: string): Promise<SourceFile[]> {
  const files: SourceFile[] = []
  const harnessDirs = getKnownHarnessDirs()
  await walk(baseDir, baseDir, files, harnessDirs, true)
  return files
}

/** Canonicalize one selected boundary, then reuse it for every file in that plan. */
export async function createFileReader(projectRoot: string) {
  const boundary = await createConfinement(projectRoot)
  return async (relativePath: string): Promise<Buffer | null> => {
    const fullPath = await boundary.resolve(relativePath)
    try {
      return await readFile(fullPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }
}

/**
 * Reads disk content for every file tracked in sync state.
 * Returns a map of targetPath → content (or null if deleted).
 */
export async function readDiskContents(
  projectRoot: string,
  syncState: SyncState,
): Promise<Record<string, string | Uint8Array | null>> {
  const result: Record<string, string | Uint8Array | null> = {}
  const read = await createFileReader(projectRoot)
  for (const targetPath of Object.keys(syncState.files)) {
    result[targetPath] = await read(targetPath)
  }
  return result
}

async function walk(
  baseDir: string,
  currentDir: string,
  files: SourceFile[],
  harnessDirs: Set<string>,
  isTopLevel: boolean,
): Promise<void> {
  const entries = await readdir(currentDir, {withFileTypes: true})

  for (const entry of entries) {
    if (entry.name.startsWith('.')) {
      // At top level, allow known harness dot-directories (.claude, .cursor, etc.)
      if (!(isTopLevel && entry.isDirectory() && harnessDirs.has(entry.name))) continue
    }

    const fullPath = join(currentDir, entry.name)

    if (entry.isSymbolicLink()) continue

    if (entry.isDirectory()) {
      await walk(baseDir, fullPath, files, harnessDirs, false)
    } else if (entry.isFile()) {
      const content = await readFile(fullPath, 'utf-8')
      const relativePath = relative(baseDir, fullPath).split(sep).join('/')
      files.push({relativePath, content})
    }
  }
}
