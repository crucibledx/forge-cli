import pc from 'picocolors'

import type {DetectionResult} from '@domain/assistants'
import type {OutputEntry} from '@domain/protocol/types'
import type {SyncFileStatus} from '@domain/sync/types'
import {SYNC_FILE_STATUSES} from '@domain/sync/types'

export function renderHeader(title: string): void {
  const line = '─'.repeat(title.length + 4)
  console.log()
  console.log(pc.bold(`  ┌${line}┐`))
  console.log(pc.bold(`  │  ${title}  │`))
  console.log(pc.bold(`  └${line}┘`))
  console.log()
}

export function renderDetectionResults(results: DetectionResult[]): void {
  for (const r of results) {
    const icon = r.detected ? pc.green('✓') : pc.dim('○')
    const label = r.detected ? pc.white(r.name) : pc.dim(r.name)
    const detail = r.evidence ? pc.dim(`  (${r.evidence})`) : r.detected ? '' : pc.dim('  (not detected)')
    console.log(`  ${icon} ${label}${detail}`)
  }
}

const syncStatusRenderers: Record<string, (path: string, dryRun: boolean) => void> = {
  [SYNC_FILE_STATUSES.NEW]: (path, dryRun) =>
    console.log(`  ${dryRun ? pc.green('+') : pc.green('✓')}  ${pc.white(path)}  ${pc.dim('(new)')}`),
  [SYNC_FILE_STATUSES.UPDATE]: (path, dryRun) =>
    console.log(`  ${dryRun ? pc.yellow('~') : pc.green('✓')}  ${pc.white(path)}  ${pc.dim('(update)')}`),
  [SYNC_FILE_STATUSES.NO_CHANGE]: (path) => console.log(`  ${pc.dim('=')}  ${pc.dim(path)}  ${pc.dim('(no change)')}`),
  [SYNC_FILE_STATUSES.SKIPPED]: (path) =>
    console.log(`  ${pc.yellow('⊘')}  ${pc.yellow(path)}  ${pc.dim('(local-wins)')}`),
  [SYNC_FILE_STATUSES.ERROR]: (path) => console.log(`  ${pc.red('✗')}  ${pc.red(path)}  ${pc.red('(error)')}`),
}

export function renderSyncFile(path: string, status: SyncFileStatus, dryRun: boolean): void {
  const render = syncStatusRenderers[status]
  if (render) render(path, dryRun)
}

export function renderSuccess(message: string): void {
  console.log(`  ${pc.green('✓')} ${message}`)
}

export function renderInfo(message: string): void {
  console.log(`  ${pc.blue('ℹ')} ${message}`)
}

export function renderWarning(message: string): void {
  console.log(`  ${pc.yellow('⚠')} ${message}`)
}

export function renderError(message: string, suggestion?: string): void {
  console.log(`  ${pc.red('✗')} ${pc.red(message)}`)
  if (suggestion) {
    console.log(`    ${pc.dim(suggestion)}`)
  }
}

export function renderDim(message: string): void {
  console.log(`  ${pc.dim(message)}`)
}

export function render(message: string): void {
  console.log(`  ${message}`)
}

export function renderNewline(): void {
  console.log()
}

const levelRenderers: Record<string, (message: string) => void> = {
  success: renderSuccess,
  info: renderInfo,
  warn: renderWarning,
  error: (msg) => renderError(msg),
  debug: renderDim,
}

export function renderOutputEntries(entries: OutputEntry[]): void {
  for (const entry of entries) {
    const render = levelRenderers[entry.level]
    if (render) render(entry.message)
    if (entry.detail) {
      renderDim(`  ${entry.detail}`)
    }
  }
}
