import type {AssistantId} from '../assistants/types'

export const MUTATION_TYPES = {
  FILE_WRITE: 'file_write',
  FILE_DELETE: 'file_delete',
  DIR_CREATE: 'dir_create',
  SYMLINK_CREATE: 'symlink_create',
} as const

export type MutationType = (typeof MUTATION_TYPES)[keyof typeof MUTATION_TYPES]

export type Mutation =
  | {type: typeof MUTATION_TYPES.FILE_WRITE; path: string; content: string}
  | {type: typeof MUTATION_TYPES.FILE_DELETE; path: string}
  | {type: typeof MUTATION_TYPES.DIR_CREATE; path: string}
  | {type: typeof MUTATION_TYPES.SYMLINK_CREATE; path: string; target: string}

export const SYNC_FILE_STATUSES = {
  NEW: 'new',
  UPDATE: 'update',
  NO_CHANGE: 'no_change',
  SKIPPED: 'skipped',
  DELETED: 'deleted',
  ERROR: 'error',
} as const

export type SyncFileStatus = (typeof SYNC_FILE_STATUSES)[keyof typeof SYNC_FILE_STATUSES]

export interface SyncFileSummary {
  targetPath: string
  sourcePath: string
  assistantId: AssistantId
  status: SyncFileStatus
  error?: string
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
  sourceName: string
}
