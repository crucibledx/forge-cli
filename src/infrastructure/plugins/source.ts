import {stat} from 'node:fs/promises'
import {resolve} from 'node:path'

import type {PluginConfig, PluginFile} from '@domain/plugins'
import {lockedSource} from '@domain/plugins'
import {redact} from '@domain/redact'

import {PluginSourceError} from './errors'
import {readPluginFiles} from './files'
import {readGitPlugin, resolveGitCommit} from './git'

export interface PluginSourceContext {
  /** Base for relative `local` paths: the project root, or home for user scope. */
  root: string
  home: string
}

export interface AcquiredPlugin {
  files: PluginFile[]
  resolved?: string
}

/** Fetch a plugin's package files; git sources resolve `ref`, or fetch the `locked` commit when given. */
export async function acquirePluginSource(
  plugin: PluginConfig,
  context: PluginSourceContext,
  locked?: string,
): Promise<AcquiredPlugin> {
  try {
    const source = lockedSource(plugin.source)
    if (source.type === 'local') {
      const dir = resolve(context.root, source.path.replace(/^~(?=$|[/\\])/, context.home))
      if (!(await stat(dir).catch(() => null))?.isDirectory())
        throw new PluginSourceError(plugin.name, `local path does not exist or is not a directory: ${source.path}`)
      return {files: await readPluginFiles(dir)}
    }
    if (source.type === 'generated')
      throw new PluginSourceError(plugin.name, 'generated plugins cannot be installed from config')
    const {bare, sha} = await resolveGitCommit(source.url, source.ref, locked)
    return {files: await readGitPlugin(bare, sha, source.path), resolved: sha}
  } catch (error) {
    if (error instanceof PluginSourceError) throw error
    throw new PluginSourceError(plugin.name, redact(error instanceof Error ? error.message : String(error)))
  }
}
