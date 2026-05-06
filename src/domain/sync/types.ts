import type {AssistantId} from '../assistants/types'

export type Mutation =
    | {type: 'file_write', path: string, content: string}
    | {type: 'file_delete', path: string}
    | {type: 'dir_create', path: string}
    | {type: 'symlink_create', path: string, target: string}

export interface SyncFileSummary {
    targetPath: string
    sourcePath: string
    assistantId: AssistantId
    status: 'new' | 'update' | 'no_change'
}

export interface SyncPlan {
    sourceName: string
    mutations: Mutation[]
    files: SyncFileSummary[]
}

export interface SyncResult {
    applied: number
    skipped: number
    errors: Array<{path: string, error: string}>
    lastSync: string // ISO date
}

export interface SourceFile {
    relativePath: string
    content: string
}

export interface ResolvedTarget {
    sourcePath: string
    targetPath: string
    content: string
    assistantId: AssistantId
}
