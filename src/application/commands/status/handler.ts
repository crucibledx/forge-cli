import {getAssistant} from '@domain/assistants'
import type {ProjectConfig} from '@domain/config/types'
import {SYNC_CONFIG_DEFAULTS} from '@domain/config/types'
import {formatShortDateTime} from '@domain/format'
import {describeCron, nextCronRun} from '@domain/scheduler'
import {detectDrift, detectFullDrift} from '@domain/sync/drift'
import {resolveSourceConflicts} from '@domain/sync/merge'
import {resolveTargets} from '@domain/sync/resolver'
import * as renderer from '@infrastructure/cli/renderer'
import {loadSyncState} from '@infrastructure/config'
import {readDiskContents} from '@infrastructure/fs'
import io from '@infrastructure/io'
import {createFileLogger} from '@infrastructure/logger'
import {getSchedulerBackend} from '@infrastructure/scheduler'
import {loadSourceFiles} from '@infrastructure/source'

import {CommandError} from '../types'
import {displayDrift} from './display'
import {STATUS_MESSAGES as M} from './messages'
import type {StatusCommandAction} from './types'

export const runStatus: StatusCommandAction = async () => {
  const logger = createFileLogger()
  const projectRoot = io.resolveProjectRoot()
  const context = await io.buildContext(projectRoot)

  if (!context.projectConfig) {
    throw new CommandError(M.errors.noConfig, M.errors.noConfigHint)
  }

  const config = context.projectConfig
  const syncState = await loadSyncState(projectRoot)

  if (!syncState.lastSync) {
    renderer.renderWarning(M.errors.neverSynced)
    await showConfigContext(config, projectRoot)
    return
  }
  const diskContents = await readDiskContents(projectRoot, syncState)

  // Try to fetch remote state for richer drift info
  const remoteContents = await fetchRemoteContents(config)

  const summary = remoteContents
    ? detectFullDrift(syncState, diskContents, remoteContents)
    : detectDrift(syncState, diskContents)

  logger.debug('status checked', {driftCount: summary.files.length, hasRemote: !!remoteContents})
  displayDrift(summary)
}

async function showConfigContext(config: ProjectConfig, projectRoot: string): Promise<void> {
  renderer.renderNewline()
  renderer.renderDim(M.context.assistants(config.assistants.filter((a) => a.enabled !== false).map((a) => a.id)))

  if (config.sources.length > 0) {
    renderer.renderDim(M.context.sources(config.sources.map((s) => s.name)))
  } else {
    renderer.renderDim(M.context.noSources)
  }

  const srcStrategy = config.sync?.source_conflict_strategy ?? SYNC_CONFIG_DEFAULTS.source_conflict_strategy
  const localStrategy = config.sync?.local_conflict_strategy ?? SYNC_CONFIG_DEFAULTS.local_conflict_strategy
  const backup = config.sync?.backup ?? SYNC_CONFIG_DEFAULTS.backup
  renderer.renderDim(M.context.syncStrategy(srcStrategy, localStrategy))
  renderer.renderDim(M.context.syncBackup(backup))

  const schedule = config.sync?.schedule
  const backend = getSchedulerBackend()
  const installed = await backend.isInstalled(projectRoot)

  if (schedule) {
    renderer.renderDim(M.context.schedule(describeCron(schedule)))
  } else {
    renderer.renderDim(M.context.noSchedule)
  }

  if (installed) {
    renderer.renderSuccess(M.context.schedulerInstalled)
  } else {
    renderer.renderDim(M.context.schedulerNotInstalled)
  }

  renderer.renderNewline()

  if (config.sources.length === 0) {
    renderer.renderDim(M.context.hintNoSources)
  } else if (installed && schedule) {
    const next = nextCronRun(schedule)
    const nextStr = next ? formatShortDateTime(next) : 'unknown'
    renderer.renderDim(M.context.hintSchedulerActive(nextStr))
  } else if (schedule && !installed) {
    renderer.renderDim(M.context.hintScheduleNotInstalled)
  } else {
    renderer.renderDim(M.context.hintNoSchedule)
  }
}

async function fetchRemoteContents(config: ProjectConfig): Promise<Record<string, string> | null> {
  if (config.sources.length === 0) return null

  try {
    const assistantDefs = config.assistants.map((a) => getAssistant(a.id))
    const allResolved = []

    for (const source of config.sources) {
      const sourceFiles = await loadSourceFiles(source)
      const resolved = resolveTargets(sourceFiles, assistantDefs, source.name, source.layout)
      allResolved.push(...resolved)
    }

    const strategy = config.sync?.source_conflict_strategy ?? SYNC_CONFIG_DEFAULTS.source_conflict_strategy
    const merged = resolveSourceConflicts(allResolved, strategy)

    const contents: Record<string, string> = {}
    for (const target of merged) {
      contents[target.targetPath] = target.content
    }
    return contents
  } catch {
    return null
  }
}
