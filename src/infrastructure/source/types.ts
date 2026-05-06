import type {Source} from '@domain/config/types'

export interface SourceLoadResult {
    localPath: string
    fresh: boolean
}

export interface SourceLoaderEntry {
    alias: string
    label: string
    configure: () => Promise<Source>
    load: (source: Source) => Promise<SourceLoadResult>
}

export type SourceLoaderDictionary = Record<string, SourceLoaderEntry>
