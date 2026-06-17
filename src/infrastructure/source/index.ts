import './git'
import './local'

import type {Source} from '@domain/config/types'
import {applySourceFilters} from '@domain/sync/filter'
import type {SourceFile} from '@domain/sync/types'

import {collectFiles} from '../fs'
import {loadersRegistry} from './registry'
import type {SourceLoaderEntry} from './types'

export {sourceConfigSchema} from './schema'

export function getSourceLoader(type: string): SourceLoaderEntry {
  const loader = loadersRegistry.find((l) => l.alias === type)
  if (!loader) {
    const available = loadersRegistry.map((l) => l.alias).join(', ')
    throw new Error(`Unsupported source type: "${type}". Available: ${available}`)
  }
  return loader
}

export async function loadSourceFiles(source: Source): Promise<SourceFile[]> {
  const loader = getSourceLoader(source.type)
  const {localPath} = await loader.load(source)
  const files = await collectFiles(localPath)
  return applySourceFilters(files, source)
}

export function getSourceLoaderOptions(): Array<{value: string; label: string}> {
  return loadersRegistry.map((l) => ({value: l.alias, label: l.label}))
}

export {DEFAULT_SOURCE_NAME} from './constants'
export {GIT_SOURCE_MESSAGES} from './git'
export type {GitSourceConfig} from './git/types'
export {LOCAL_SOURCE_MESSAGES, LocalSourceError} from './local'
export type {LocalSourceConfig} from './local/types'
export type {SourceLoaderEntry, SourceLoadResult} from './types'
