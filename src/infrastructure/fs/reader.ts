import {existsSync} from 'node:fs'
import {readdir, readFile} from 'node:fs/promises'
import {join, relative} from 'node:path'

import {getAllAssistants} from '@domain/assistants'
import type {SyncState} from '@domain/sync/state'
import type {SourceFile} from '@domain/sync/types'

import {createConfinement} from './confinement'

function getKnownAssistantDirs(): Set<string> {
  const dirs = new Set<string>()
  for (const assistant of getAllAssistants()) {
    for (const mapping of assistant.targetMappings) {
      const topDir = mapping.destination.project.split('/')[0]
      if (topDir) dirs.add(topDir)
    }
  }
  return dirs
}

export async function collectFiles(baseDir: string): Promise<SourceFile[]> {
  if (!existsSync(baseDir)) {
    return []
  }

  const files: SourceFile[] = []
  const assistantDirs = getKnownAssistantDirs()
  await walk(baseDir, baseDir, files, assistantDirs, true)
  return files
}

/**
 * Reads a single file relative to projectRoot. Returns content or null if missing.
 */
export async function readFileContent(projectRoot: string, relativePath: string): Promise<string | null> {
  return (await readFileBytes(projectRoot, relativePath))?.toString('utf8') ?? null
}

export async function readFileBytes(projectRoot: string, relativePath: string): Promise<Buffer | null> {
  const fullPath = await (await createConfinement(projectRoot)).resolve(relativePath)
  try {
    return await readFile(fullPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
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
  for (const targetPath of Object.keys(syncState.files)) {
    result[targetPath] = await readFileBytes(projectRoot, targetPath)
  }
  return result
}

async function walk(
  baseDir: string,
  currentDir: string,
  files: SourceFile[],
  assistantDirs: Set<string>,
  isTopLevel: boolean,
): Promise<void> {
  const entries = await readdir(currentDir, {withFileTypes: true})

  for (const entry of entries) {
    if (entry.name.startsWith('.')) {
      // At top level, allow known assistant dot-directories (.claude, .cursor, etc.)
      if (!(isTopLevel && entry.isDirectory() && assistantDirs.has(entry.name))) continue
    }

    const fullPath = join(currentDir, entry.name)

    if (entry.isSymbolicLink()) continue

    if (entry.isDirectory()) {
      await walk(baseDir, fullPath, files, assistantDirs, false)
    } else if (entry.isFile()) {
      const content = await readFile(fullPath, 'utf-8')
      const relativePath = relative(baseDir, fullPath)
      files.push({relativePath, content})
    }
  }
}
