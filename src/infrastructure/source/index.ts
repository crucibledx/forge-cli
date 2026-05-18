import {loadersRegistry} from '@infrastructure/source/registry'

import type {SourceLoaderDictionary, SourceLoaderEntry} from './types'

export const sourceLoaders: SourceLoaderDictionary = Object.fromEntries(
  loadersRegistry.map((loader) => [loader.alias, loader]),
)

export {sourceConfigSchema} from './schema'

export function getSourceLoader(type: string): SourceLoaderEntry {
  const loader = sourceLoaders[type]
  if (!loader) {
    throw new Error(`Unsupported source type: "${type}". Available: ${Object.keys(sourceLoaders).join(', ')}`)
  }
  return loader
}

export function getSourceLoaderOptions(): Array<{value: string; label: string}> {
  return loadersRegistry.map((l) => ({value: l.alias, label: l.label}))
}

export {DEFAULT_SOURCE_NAME} from './constants'
export {GIT_SOURCE_MESSAGES} from './git'
export type {GitSourceConfig} from './git/types'
export {LOCAL_SOURCE_MESSAGES, LocalSourceError} from './local'
export type {LocalSourceConfig} from './local/types'
export type {SourceLoaderDictionary, SourceLoaderEntry, SourceLoadResult} from './types'
