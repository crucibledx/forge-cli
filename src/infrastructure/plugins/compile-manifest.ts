import {readdir} from 'node:fs/promises'
import {join} from 'node:path'

import type {PluginFile, PluginScope} from '@domain/plugins'
import {PLUGIN_SCOPES} from '@domain/plugins'

/** Manifest directories relative to the project root (project scope) or home (user scope) (spec 0005 §5). */
export const COMPILE_MANIFEST_DIRS: Record<PluginScope, string> = {
  [PLUGIN_SCOPES.PROJECT]: join('.crucible', 'compile'),
  [PLUGIN_SCOPES.USER]: join('.crucible', 'forge', 'compile'),
}
export const COMPILE_MANIFEST_GITIGNORE: PluginFile = {path: '.gitignore', content: Buffer.from('*\n')}

/** Manifest file names currently on disk, so a harness no longer compiled gets its manifest pruned. */
export async function listCompileManifests(dir: string): Promise<string[]> {
  const entries = await readdir(dir, {withFileTypes: true}).catch(() => [] as const)
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => entry.name)
    .sort()
}
