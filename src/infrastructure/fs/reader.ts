import {existsSync} from 'node:fs'
import {readdir, readFile} from 'node:fs/promises'
import {join, relative} from 'node:path'

import type {SyncState} from '@domain/sync/state'
import type {SourceFile} from '@domain/sync/types'

export async function collectFiles(baseDir: string): Promise<SourceFile[]> {
  if (!existsSync(baseDir)) {
    return []
  }

  const files: SourceFile[] = []
  await walk(baseDir, baseDir, files)
  return files
}

/**
 * Reads a single file relative to projectRoot. Returns content or null if missing.
 */
export async function readFileContent(projectRoot: string, relativePath: string): Promise<string | null> {
  const fullPath = join(projectRoot, relativePath)
  if (!existsSync(fullPath)) return null
  return readFile(fullPath, 'utf-8')
}

/**
 * Reads disk content for every file tracked in sync state.
 * Returns a map of targetPath → content (or null if deleted).
 */
export async function readDiskContents(
  projectRoot: string,
  syncState: SyncState,
): Promise<Record<string, string | null>> {
  const result: Record<string, string | null> = {}
  for (const targetPath of Object.keys(syncState.files)) {
    result[targetPath] = await readFileContent(projectRoot, targetPath)
  }
  return result
}

async function walk(baseDir: string, currentDir: string, files: SourceFile[]): Promise<void> {
  const entries = await readdir(currentDir, {withFileTypes: true})

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue

    const fullPath = join(currentDir, entry.name)

    if (entry.isDirectory()) {
      await walk(baseDir, fullPath, files)
    } else if (entry.isFile()) {
      const content = await readFile(fullPath, 'utf-8')
      const relativePath = relative(baseDir, fullPath)
      files.push({relativePath, content})
    }
  }
}
