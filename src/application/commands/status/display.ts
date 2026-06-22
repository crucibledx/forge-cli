import type {AssistantId} from '@domain/assistants'
import {getAssistant, resolveAssistantByPath} from '@domain/assistants'
import {formatTimeAgo} from '@domain/format'
import type {DriftSummary} from '@domain/sync/drift'
import {DRIFT_STATUSES} from '@domain/sync/drift'
import * as renderer from '@infrastructure/cli/renderer'

import {STATUS_MESSAGES as M} from './messages'

export {formatTimeAgo}

function assistantIdForPath(targetPath: string): AssistantId {
  return resolveAssistantByPath(targetPath)?.id ?? 'claude-code'
}

// ─── Display ─────────────────────────────────────────────────────────────────

export function displayDrift(summary: DriftSummary): void {
  renderer.renderInfo(M.output.lastSync(formatTimeAgo(summary.lastSync)))
  renderer.renderNewline()

  if (summary.files.length === 0) {
    renderer.renderSuccess(M.output.allInSync)
    return
  }

  const byAssistant = Object.groupBy(summary.files, (f) => assistantIdForPath(f.targetPath))

  for (const [assistantId, files] of Object.entries(byAssistant)) {
    if (!files) continue
    const def = getAssistant(assistantId as AssistantId)
    renderer.render(`${def.name}:`)
    for (const file of files) {
      renderer.renderDriftFile(file.targetPath, file.status)
    }
    renderer.renderNewline()
  }

  const counts = {
    modified: summary.files.filter((f) => f.status === DRIFT_STATUSES.MODIFIED).length,
    deleted: summary.files.filter((f) => f.status === DRIFT_STATUSES.DELETED).length,
    remoteUpdated: summary.files.filter((f) => f.status === DRIFT_STATUSES.REMOTE_UPDATED).length,
    conflict: summary.files.filter((f) => f.status === DRIFT_STATUSES.CONFLICT).length,
    newInSource: summary.files.filter((f) => f.status === DRIFT_STATUSES.NEW_IN_SOURCE).length,
    removedFromSource: summary.files.filter((f) => f.status === DRIFT_STATUSES.REMOVED_FROM_SOURCE).length,
  }

  if (counts.remoteUpdated > 0) renderer.renderInfo(M.summary.remoteUpdated(counts.remoteUpdated))
  if (counts.newInSource > 0) renderer.renderInfo(M.summary.newInSource(counts.newInSource))
  if (counts.modified > 0) renderer.renderWarning(M.summary.modified(counts.modified))
  if (counts.conflict > 0) renderer.renderWarning(M.summary.conflict(counts.conflict))
  if (counts.deleted > 0) renderer.renderWarning(M.summary.deleted(counts.deleted))
  if (counts.removedFromSource > 0) renderer.renderDim(M.summary.removedFromSource(counts.removedFromSource))

  const hasActionable =
    counts.modified +
      counts.deleted +
      counts.remoteUpdated +
      counts.conflict +
      counts.newInSource +
      counts.removedFromSource >
    0
  if (hasActionable) {
    renderer.renderNewline()
    renderer.renderDim(M.output.hint)
  }
}
