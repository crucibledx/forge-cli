import {gitLoader} from './git'
import type {SourceLoaderDictionary, SourceLoaderEntry} from './types'

const loaders: SourceLoaderEntry[] = [
    gitLoader,
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

export type {SourceLoaderDictionary, SourceLoaderEntry, SourceLoadResult} from './types'
