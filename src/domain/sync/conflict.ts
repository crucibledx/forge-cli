import type {LocalConflictStrategy} from '../config/types'
import {LOCAL_CONFLICT_STRATEGIES} from '../config/types'
import type {SyncState} from './state'
import {hashContent} from './state'

// ─── Types ───────────────────────────────────────────────────────────────────

export const CONFLICT_ACTIONS = {
  WRITE: 'write',
  SKIP: 'skip',
  ERROR: 'error',
} as const

export type ConflictAction = (typeof CONFLICT_ACTIONS)[keyof typeof CONFLICT_ACTIONS]

export interface ConflictResult {
  action: ConflictAction
}

export interface LocalConflict {
  targetPath: string
  localHash: string
  storedHash: string
  remoteHash: string
}

export class LocalConflictError extends Error {
  conflicts: LocalConflict[]

  constructor(conflicts: LocalConflict[]) {
    const paths = conflicts.map((c) => `  ${c.targetPath}`).join('\n')
    super(`Local conflict on ${conflicts.length} file(s):\n${paths}`)
    this.name = 'LocalConflictError'
    this.conflicts = conflicts
  }
}

// ─── Detection ───────────────────────────────────────────────────────────────

/**
 * Determines if a locally existing file has been modified since the last sync.
 *
 * A local conflict exists when ALL of:
 * 1. The file was previously synced (exists in sync state)
 * 2. The local content hash differs from the stored hash (user edited it)
 * 3. The remote content hash differs from the stored hash (source changed too)
 *
 * If the file is new (not in sync state) or unchanged locally, there's no conflict.
 */
export function detectLocalConflict(
  targetPath: string,
  localContent: string,
  remoteContent: string,
  syncState: SyncState,
): LocalConflict | null {
  const entry = syncState.files[targetPath]
  if (!entry) return null

  const localHash = hashContent(localContent)
  const remoteHash = hashContent(remoteContent)

  if (localHash === entry.hash) return null
  if (remoteHash === entry.hash) return null

  return {targetPath, localHash, storedHash: entry.hash, remoteHash}
}

// ─── Resolution ──────────────────────────────────────────────────────────────

/**
 * Resolves a local conflict according to the chosen strategy.
 *
 * - **remote-wins** → overwrite (action: 'write')
 * - **local-wins** → skip the file (action: 'skip')
 * - **error** → collect for batch error (action: 'error')
 */
const conflictResolutionMap: Record<LocalConflictStrategy, ConflictResult> = {
  [LOCAL_CONFLICT_STRATEGIES.REMOTE_WINS]: {action: CONFLICT_ACTIONS.WRITE},
  [LOCAL_CONFLICT_STRATEGIES.LOCAL_WINS]: {action: CONFLICT_ACTIONS.SKIP},
  [LOCAL_CONFLICT_STRATEGIES.ERROR]: {action: CONFLICT_ACTIONS.ERROR},
}

export function resolveLocalConflict(strategy: LocalConflictStrategy): ConflictResult {
  return conflictResolutionMap[strategy]
}
