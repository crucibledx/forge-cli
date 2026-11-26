import {existsSync} from 'node:fs'
import {readdir} from 'node:fs/promises'
import {join} from 'node:path'

import type {DeliveredFiles, PluginFile, PluginLock, PluginLockEntry, PluginScope} from '@domain/plugins'
import {hashPluginFiles, PLUGIN_SCOPES} from '@domain/plugins'

import {readPluginFiles} from './files'
import {PLUGIN_NAME} from './manifest'

/** Relative to the project root (project scope) or home (user scope). Never committed: the lock is the truth. */
export const PLUGIN_CACHE_DIRS: Record<PluginScope, string> = {
  [PLUGIN_SCOPES.PROJECT]: join('.crucible', 'plugins'),
  [PLUGIN_SCOPES.USER]: join('.crucible', 'forge', 'plugins'),
}
export const CACHE_GITIGNORE: PluginFile = {path: '.gitignore', content: Buffer.from('*\n')}
const SOURCE_DIR = 'source'

/** Files to write under the cache root: the package copy and each harness's emitted plugin directory. */
export function pluginCacheFiles(
  entry: PluginLockEntry,
  files: PluginFile[],
  outputs: Record<string, DeliveredFiles>,
): PluginFile[] {
  const base = `${entry.name}/${entry.version}`
  return [
    CACHE_GITIGNORE,
    ...files.map((file) => ({...file, path: `${base}/${SOURCE_DIR}/${file.path}`})),
    ...Object.entries(outputs).flatMap(([harness, delivered]) =>
      delivered.plugin.map((file) => ({...file, path: `${base}/${harness}/${file.path}`})),
    ),
  ]
}

/** The cached package copy for a lock entry, or null on a miss or when it no longer matches `contentHash`. */
export async function readCachedPlugin(cacheRoot: string, entry: PluginLockEntry): Promise<PluginFile[] | null> {
  const dir = join(cacheRoot, entry.name, entry.version, SOURCE_DIR)
  if (!existsSync(dir)) return null
  const files = await readPluginFiles(dir).catch(() => null)
  return files && hashPluginFiles(files) === entry.contentHash ? files : null
}

/**
 * Cache directories (`<name>` or `<name>/<version>`) that no lock entry references. Only plugin-name directories
 * count, so the marketplace catalogs (`.claude-plugin/`, `.factory-plugin/`) beside them are never pruned.
 */
export async function unreferencedCacheDirs(cacheRoot: string, lock: PluginLock): Promise<string[]> {
  const list = async (dir: string) =>
    (await readdir(dir, {withFileTypes: true}).catch(() => [])).filter((e) => e.isDirectory()).map((e) => e.name)
  const stale: string[] = []
  for (const name of (await list(cacheRoot)).filter((dir) => PLUGIN_NAME.test(dir))) {
    const entry = lock.plugins.find((plugin) => plugin.name === name)
    if (!entry) stale.push(name)
    else
      for (const version of await list(join(cacheRoot, name)))
        if (version !== entry.version) stale.push(`${name}/${version}`)
  }
  return stale
}
