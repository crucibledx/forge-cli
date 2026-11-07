import pc from 'picocolors'

import type {DetectionResult} from '@domain/assistants'
import type {OutputEntry} from '@domain/protocol/types'
import type {DriftStatus} from '@domain/sync/drift'
import {DRIFT_STATUSES} from '@domain/sync/drift'
import type {SyncFileStatus} from '@domain/sync/types'
import {SYNC_FILE_STATUSES} from '@domain/sync/types'

import {terminalText} from './terminal-text'

let silent = false

export function setSilent(value: boolean): void {
  silent = value
}

function log(...args: string[]): void {
  // Renderers sanitize fields before trusted formatting. Re-parsing escaped
  // newlines here would merge public diagnostics into an earlier credential.
  if (!silent) console.log(...args)
}

export function renderHeader(title: string): void {
  title = terminalText(title)
  const line = '─'.repeat(title.length + 4)
  log()
  log(pc.bold(`  ┌${line}┐`))
  log(pc.bold(`  │  ${title}  │`))
  log(pc.bold(`  └${line}┘`))
  log()
}

export function renderDetectionResults(results: DetectionResult[]): void {
  for (const r of results) {
    const icon = r.detected ? pc.green('✓') : pc.dim('○')
    const name = terminalText(r.name)
    const label = r.detected ? pc.white(name) : pc.dim(name)
    const detail = r.evidence ? pc.dim(`  (${terminalText(r.evidence)})`) : r.detected ? '' : pc.dim('  (not detected)')
    log(`  ${icon} ${label}${detail}`)
  }
}

const syncStatusRenderers: Record<string, (path: string, dryRun: boolean) => void> = {
  [SYNC_FILE_STATUSES.NEW]: (path, dryRun) =>
    log(`  ${dryRun ? pc.green('+') : pc.green('✓')}  ${pc.white(path)}  ${pc.dim('(new)')}`),
  [SYNC_FILE_STATUSES.UPDATE]: (path, dryRun) =>
    log(`  ${dryRun ? pc.yellow('~') : pc.green('✓')}  ${pc.white(path)}  ${pc.dim('(update)')}`),
  [SYNC_FILE_STATUSES.NO_CHANGE]: (path) => log(`  ${pc.dim('=')}  ${pc.dim(path)}  ${pc.dim('(no change)')}`),
  [SYNC_FILE_STATUSES.SKIPPED]: (path) => log(`  ${pc.yellow('⊘')}  ${pc.yellow(path)}  ${pc.dim('(local-wins)')}`),
  [SYNC_FILE_STATUSES.DELETED]: (path, dryRun) =>
    log(`  ${dryRun ? pc.red('-') : pc.red('✓')}  ${pc.red(path)}  ${pc.dim('(removed from source)')}`),
  [SYNC_FILE_STATUSES.ERROR]: (path) => log(`  ${pc.red('✗')}  ${pc.red(path)}  ${pc.red('(error)')}`),
}

export function renderSyncFile(path: string, status: SyncFileStatus, dryRun: boolean): void {
  const render = syncStatusRenderers[status]
  if (render) render(terminalText(path), dryRun)
}

const driftStatusRenderers: Record<string, (path: string) => void> = {
  [DRIFT_STATUSES.LEGACY_UNKNOWN]: (path) => log(`  ${pc.yellow('?')}  ${path}  (legacy-unknown baseline)`),
  [DRIFT_STATUSES.IN_SYNC]: (path) => log(`  ${pc.green('✓')}  ${pc.dim(path)}  ${pc.dim('(in sync)')}`),
  [DRIFT_STATUSES.MODIFIED]: (path) => log(`  ${pc.yellow('✗')}  ${pc.yellow(path)}  ${pc.dim('(locally modified)')}`),
  [DRIFT_STATUSES.DELETED]: (path) => log(`  ${pc.red('-')}  ${pc.red(path)}  ${pc.dim('(deleted)')}`),
  [DRIFT_STATUSES.REMOTE_UPDATED]: (path) => log(`  ${pc.blue('↓')}  ${pc.white(path)}  ${pc.dim('(remote updated)')}`),
  [DRIFT_STATUSES.CONFLICT]: (path) =>
    log(`  ${pc.red('✗')}  ${pc.red(path)}  ${pc.dim('(locally modified — conflict)')}`),
  [DRIFT_STATUSES.NEW_IN_SOURCE]: (path) => log(`  ${pc.green('+')}  ${pc.green(path)}  ${pc.dim('(new in source)')}`),
  [DRIFT_STATUSES.REMOVED_FROM_SOURCE]: (path) =>
    log(`  ${pc.red('-')}  ${pc.red(path)}  ${pc.dim('(removed from source)')}`),
}

export function renderDriftFile(path: string, status: DriftStatus): void {
  const render = driftStatusRenderers[status]
  if (render) render(terminalText(path))
}

export function renderSuccess(message: string): void {
  log(`  ${pc.green('✓')} ${terminalText(message)}`)
}

export function renderInfo(message: string): void {
  log(`  ${pc.blue('ℹ')} ${terminalText(message)}`)
}

export function renderWarning(message: string): void {
  log(`  ${pc.yellow('⚠')} ${terminalText(message)}`)
}

export function renderError(message: string, suggestion?: string): void {
  log(`  ${pc.red('✗')} ${pc.red(terminalText(message))}`)
  if (suggestion) {
    log(`    ${pc.dim(terminalText(suggestion))}`)
  }
}

export function renderDim(message: string): void {
  log(`  ${pc.dim(terminalText(message))}`)
}

export function render(message: string): void {
  log(`  ${terminalText(message)}`)
}

export function renderNewline(): void {
  log()
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
