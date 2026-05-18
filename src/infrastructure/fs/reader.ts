import {existsSync} from 'node:fs'
import {readdir, readFile} from 'node:fs/promises'
import {join, relative} from 'node:path'

import type {SourceFile} from '@domain/sync/types'

export async function collectFiles(baseDir: string): Promise<SourceFile[]> {
  if (!existsSync(baseDir)) {
    return []
  }

  const files: SourceFile[] = []
  await walk(baseDir, baseDir, files)
  return files
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
