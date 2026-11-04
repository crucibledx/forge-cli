import type {SyncState, SyncStateEntry} from './state'
import {hashContent} from './state'
import type {ResolvedTarget, SyncFileSummary} from './types'
import {SYNC_FILE_STATUSES as S} from './types'

export function reconcileState(
  previous: SyncState,
  targets: ResolvedTarget[],
  summaries: SyncFileSummary[],
  lastSync: string,
): SyncState {
  const files: Record<string, SyncStateEntry> = Object.fromEntries(
    Object.entries(previous.files).map(([path, entry]) => [
      path,
      {...entry, baseline: entry.baseline ?? 'legacy-unknown'},
    ]),
  )
  const byPath = new Map(targets.map((target) => [target.targetPath, target]))
  for (const summary of summaries) {
    if (summary.status === S.DELETED) delete files[summary.targetPath]
    if (summary.status === S.NEW || summary.status === S.UPDATE || summary.status === S.NO_CHANGE) {
      const target = byPath.get(summary.targetPath)
      if (!target) throw new Error(`Missing reconciled target: ${summary.targetPath}`)
      files[summary.targetPath] = {
        hash: hashContent(target.content),
        sourceName: target.sourceName,
        baseline: 'installed',
      }
    }
  }
  return {version: 2, lastSync, files}
}
