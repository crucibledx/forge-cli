import {gitLoader} from './git'
import {localLoader} from './local'
import type {SourceLoaderDictionary, SourceLoaderEntry} from './types'

const loaders: SourceLoaderEntry[] = [
    gitLoader,
    localLoader,
]

export const sourceLoaders: SourceLoaderDictionary = Object.fromEntries(
    loaders.map((loader) => [loader.alias, loader]),
)

export function getSourceLoader(type: string): SourceLoaderEntry {
    const loader = sourceLoaders[type]
    if (!loader) {
        throw new Error(`Unsupported source type: "${type}". Available: ${Object.keys(sourceLoaders).join(', ')}`)
    }
    return loader
}

export function getSourceLoaderOptions(): Array<{value: string, label: string}> {
    return loaders.map((l) => ({value: l.alias, label: l.label}))
}

export {DEFAULT_SOURCE_NAME} from './constants'
export {GIT_SOURCE_MESSAGES} from './git'
export {LOCAL_SOURCE_MESSAGES, LocalSourceError} from './local'
export type {SourceLoaderDictionary, SourceLoaderEntry, SourceLoadResult} from './types'
