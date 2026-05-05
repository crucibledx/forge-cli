import type {Source} from '@domain/config/types'

export interface SourceLoadResult {
    localPath: string
    fresh: boolean
}

export interface SourceLoaderEntry {
    alias: string
    label: string
    load: (source: Source) => Promise<SourceLoadResult>
}

export type SourceLoaderDictionary = Record<string, SourceLoaderEntry>
