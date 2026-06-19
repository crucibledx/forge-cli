import type {Source} from '@domain/config/types'
import * as prompts from '@infrastructure/cli/prompts'
import * as renderer from '@infrastructure/cli/renderer'
import {loadProjectConfig, loadSyncState, writeProjectConfig, writeSyncState} from '@infrastructure/config'
import io from '@infrastructure/io'
import {createFileLogger} from '@infrastructure/logger'

import {
  countFilesForSource,
  deleteSourceFiles,
  getFilesForSource,
  removeSourceFromState,
} from '../shared/source.cleanup'
import {configureSource, promptNewSource} from '../shared/source.prompt'
import {CommandError} from '../types'
import {SOURCE_COMMAND_MESSAGES as M} from './messages'

// ─── List ───────────────────────────────────────────────────────────────────

export async function runSourceList(): Promise<void> {
  const projectRoot = io.resolveProjectRoot()
  const config = await loadProjectConfig(projectRoot)

  if (!config) {
    throw new CommandError(M.errors.noConfig, M.errors.noConfigHint)
  }

  if (config.sources.length === 0) {
    renderer.renderWarning(M.errors.noSources)
    renderer.renderDim(M.errors.noSourcesHint)
    return
  }

  const syncState = await loadSyncState(projectRoot)

  renderer.renderHeader(M.list.header)
  renderer.renderNewline()

  for (const source of config.sources) {
    const detail = getSourceDetail(source)
    const fileCount = countFilesForSource(syncState, source.name)
    const syncInfo = fileCount > 0 ? M.list.syncedFiles(fileCount) : M.list.noSyncState

    renderer.renderInfo(M.list.entry(source.name, source.type, detail))
    renderer.renderDim(`  ${syncInfo}`)
  }

  renderer.renderNewline()
}

// ─── Add ────────────────────────────────────────────────────────────────────

export async function runSourceAdd(): Promise<void> {
  const projectRoot = io.resolveProjectRoot()
  const logger = createFileLogger()
  const config = await loadProjectConfig(projectRoot)

  if (!config) {
    throw new CommandError(M.errors.noConfig, M.errors.noConfigHint)
  }

  const existingNames = config.sources.map((s) => s.name)
  const source = await promptNewSource(existingNames)

  const updated = {...config, sources: [...config.sources, source]}
  await writeProjectConfig(projectRoot, updated)

  logger.info('source added', {name: source.name, type: source.type})
  renderer.renderSuccess(M.add.success(source.name))
}

// ─── Edit ──────────────────────────────────────────────────────────────────

export async function runSourceEdit(): Promise<void> {
  const projectRoot = io.resolveProjectRoot()
  const logger = createFileLogger()
  const config = await loadProjectConfig(projectRoot)

  if (!config) {
    throw new CommandError(M.errors.noConfig, M.errors.noConfigHint)
  }

  if (config.sources.length === 0) {
    renderer.renderWarning(M.errors.noSources)
    renderer.renderDim(M.errors.noSourcesHint)
    return
  }

  const sourceName = await prompts.select({
    message: M.edit.which,
    options: config.sources.map((s) => ({value: s.name, label: s.name, hint: s.type})),
  })

  const idx = config.sources.findIndex((s) => s.name === sourceName)
  const existing = config.sources[idx]
  const updated = await configureSource(existing)
  updated.name = existing.name

  const sources = [...config.sources]
  sources[idx] = updated
  await writeProjectConfig(projectRoot, {...config, sources})

  logger.info('source edited', {name: updated.name, type: updated.type})
  renderer.renderSuccess(M.edit.success(updated.name))
}

// ─── Remove ─────────────────────────────────────────────────────────────────

export async function runSourceRemove(): Promise<void> {
  const projectRoot = io.resolveProjectRoot()
  const logger = createFileLogger()
  const config = await loadProjectConfig(projectRoot)

  if (!config) {
    throw new CommandError(M.errors.noConfig, M.errors.noConfigHint)
  }

  if (config.sources.length === 0) {
    renderer.renderWarning(M.errors.noSources)
    renderer.renderDim(M.errors.noSourcesHint)
    return
  }

  const sourceName = await prompts.select({
    message: M.remove.which,
    options: config.sources.map((s) => ({value: s.name, label: s.name, hint: s.type})),
  })

  const confirmed = await prompts.confirm({
    message: M.remove.confirm(sourceName),
    initialValue: false,
  })
  if (!confirmed) return

  // Clean synced files
  const syncState = await loadSyncState(projectRoot)
  const filePaths = getFilesForSource(syncState, sourceName)

  if (filePaths.length > 0) {
    const shouldClean = await prompts.confirm({
      message: M.remove.cleanFiles(filePaths.length),
      initialValue: true,
    })

    if (shouldClean) {
      const result = await deleteSourceFiles(projectRoot, filePaths)
      const updatedState = removeSourceFromState(syncState, sourceName)
      await writeSyncState(projectRoot, updatedState)

      if (result.errors > 0) {
        renderer.renderWarning(M.remove.cleanFailed(result.cleaned, result.errors))
      } else {
        renderer.renderSuccess(M.remove.cleaned(result.cleaned))
      }
    }
  } else {
    renderer.renderDim(M.remove.nothingToClean)
  }

  // Remove source from config
  const updated = {...config, sources: config.sources.filter((s) => s.name !== sourceName)}
  await writeProjectConfig(projectRoot, updated)

  logger.info('source removed', {name: sourceName, filesCleaned: filePaths.length})
  renderer.renderSuccess(M.remove.removed(sourceName))
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getSourceDetail(source: Source): string {
  const parts: string[] = []

  if (source.type === 'git') parts.push(String(source.url ?? ''))
  if (source.type === 'local') parts.push(String(source.path ?? ''))

  if (source.layout) parts.push(`layout:${source.layout}`)
  if (source.include?.length) parts.push(`include:${source.include.join(',')}`)
  if (source.exclude?.length) parts.push(`exclude:${source.exclude.join(',')}`)
  if (source.map) parts.push(`map:${source.map}`)

  return parts.join('  ')
}
