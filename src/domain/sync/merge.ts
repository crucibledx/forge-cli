import type {SourceConflictStrategy} from '../config/types'
import {SOURCE_CONFLICT_STRATEGIES} from '../config/types'
import type {ResolvedTarget} from './types'

export interface SourceConflict {
  targetPath: string
  sources: string[]
}

export class SourceConflictError extends Error {
  conflicts: SourceConflict[]

  constructor(conflicts: SourceConflict[]) {
    const paths = conflicts.map((c) => `  ${c.targetPath} (from: ${c.sources.join(', ')})`).join('\n')
    super(`Source conflict on ${conflicts.length} file(s):\n${paths}`)
    this.name = 'SourceConflictError'
    this.conflicts = conflicts
  }
}

/**
 * Deduplicate resolved targets when multiple sources produce the same targetPath.
 *
 * - **last-wins** — later source in array wins (sources order = priority)
 * - **first-wins** — earlier source in array wins
 * - **error** — throw SourceConflictError listing all collisions
 *
 * Non-conflicting targets pass through unchanged.
 */
export function resolveSourceConflicts(targets: ResolvedTarget[], strategy: SourceConflictStrategy): ResolvedTarget[] {
  const byPath = new Map<string, ResolvedTarget[]>()

  for (const target of targets) {
    const existing = byPath.get(target.targetPath)
    if (existing) {
      existing.push(target)
    } else {
      byPath.set(target.targetPath, [target])
    }
  }

  if (strategy === SOURCE_CONFLICT_STRATEGIES.ERROR) {
    const conflicts: SourceConflict[] = []
    for (const [targetPath, group] of byPath) {
      const uniqueSources = [...new Set(group.map((t) => t.sourceName))]
      if (uniqueSources.length > 1) {
        conflicts.push({targetPath, sources: uniqueSources})
      }
    }
    if (conflicts.length > 0) {
      throw new SourceConflictError(conflicts)
    }
  }

  const result: ResolvedTarget[] = []

  for (const [, group] of byPath) {
    if (group.length === 1) {
      result.push(group[0])
    } else if (strategy === SOURCE_CONFLICT_STRATEGIES.LAST_WINS) {
      result.push(group[group.length - 1])
    } else {
      // first-wins (or error strategy with no actual cross-source conflict)
      result.push(group[0])
    }
  }

  return result
}
