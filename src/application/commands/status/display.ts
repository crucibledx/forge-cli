import {groupBy} from 'lodash-es'

import type {AssistantId} from '@domain/assistants'
import {getAssistant, resolveAssistantByPath} from '@domain/assistants'
import type {DriftSummary} from '@domain/sync/drift'
import {DRIFT_STATUSES} from '@domain/sync/drift'
import * as renderer from '@infrastructure/cli/renderer'

import {STATUS_MESSAGES as M} from './messages'

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function formatTimeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime()

  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return 'just now'

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} minute(s) ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour(s) ago`

  const days = Math.floor(hours / 24)
  return `${days} day(s) ago`
}

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

  const byAssistant = groupBy(summary.files, (f) => assistantIdForPath(f.targetPath))

  for (const [assistantId, files] of Object.entries(byAssistant)) {
    const def = getAssistant(assistantId as AssistantId)
    renderer.render(`${def.name}:`)
    for (const file of files) {
      renderer.renderDriftFile(file.targetPath, file.status)
    }
    renderer.renderNewline()
  }

  const modifiedCount = summary.files.filter((f) => f.status === DRIFT_STATUSES.MODIFIED).length
  const deletedCount = summary.files.filter((f) => f.status === DRIFT_STATUSES.DELETED).length

  if (modifiedCount > 0) renderer.renderWarning(M.summary.modified(modifiedCount))
  if (deletedCount > 0) renderer.renderWarning(M.summary.deleted(deletedCount))

  if (modifiedCount > 0 || deletedCount > 0) {
    renderer.renderNewline()
    renderer.renderDim(M.output.hint)
  }
}
