import {readdir, readFile, realpath, stat} from 'node:fs/promises'
import {join, sep} from 'node:path'

import type {PluginFile} from '@domain/plugins'
import {compare, isHashExcluded} from '@domain/plugins'

const inside = (path: string, root: string) => path === root || path.startsWith(root.endsWith(sep) ? root : root + sep)

/**
 * Every package file under `root`, minus the skills-lock exclusions. Symlinks count as their target and must
 * resolve inside the package root (and inside `boundary`, when the package sits in a larger checkout).
 */
export async function readPluginFiles(root: string, boundary?: string): Promise<PluginFile[]> {
  const base = await realpath(root)
  if (boundary && !inside(base, await realpath(boundary))) throw new Error('package path resolves outside the source')
  const files: PluginFile[] = []
  async function walk(dir: string, prefix: string, ancestors: ReadonlySet<string>): Promise<void> {
    for (const entry of await readdir(dir, {withFileTypes: true})) {
      const full = join(dir, entry.name)
      const path = prefix + entry.name
      let isDirectory = entry.isDirectory()
      if (entry.isSymbolicLink()) {
        const target = await realpath(full).catch(() => null)
        if (!target || !inside(target, base)) throw new Error(`${path} resolves outside the plugin root`)
        isDirectory = (await stat(target)).isDirectory()
      } else if (!isDirectory && !entry.isFile()) continue
      if (isHashExcluded(entry.name, isDirectory)) continue
      if (!isDirectory) {
        const executable = process.platform !== 'win32' && ((await stat(full)).mode & 0o111) !== 0
        files.push({path, content: await readFile(full), ...(executable ? {executable} : {})})
        continue
      }
      const real = await realpath(full)
      if (!ancestors.has(real)) await walk(full, `${path}/`, new Set(ancestors).add(real))
    }
  }
  await walk(base, '', new Set([base]))
  return files.sort((a, b) => compare(a.path, b.path))
}
