import {getAssistant} from '@domain/assistants'
import type {ProjectConfig} from '@domain/config/types'
import {SYNC_CONFIG_DEFAULTS} from '@domain/config/types'
import {detectDrift, detectFullDrift} from '@domain/sync/drift'
import {resolveSourceConflicts} from '@domain/sync/merge'
import {resolveTargets} from '@domain/sync/resolver'
import * as renderer from '@infrastructure/cli/renderer'
import {loadSyncState} from '@infrastructure/config'
import {collectFiles, readDiskContents} from '@infrastructure/fs'
import io from '@infrastructure/io'
import {createFileLogger} from '@infrastructure/logger'
import {getSourceLoader} from '@infrastructure/source'

import {displayDrift} from './display'
import {STATUS_MESSAGES as M} from './messages'
import type {StatusCommandAction} from './types'

export const runStatus: StatusCommandAction = async () => {
  const logger = createFileLogger()
  const projectRoot = io.resolveProjectRoot()
  const context = await io.buildContext(projectRoot)

  if (!context.projectConfig) {
    renderer.renderError(M.errors.noConfig, M.errors.noConfigHint)
    process.exit(1)
  }

  const syncState = await loadSyncState(projectRoot)

  if (!syncState.lastSync) {
    renderer.renderWarning(M.errors.neverSynced)
    return
  }

  const config = context.projectConfig
  const diskContents = await readDiskContents(projectRoot, syncState)

  // Try to fetch remote state for richer drift info
  const remoteContents = await fetchRemoteContents(config)

  const summary = remoteContents
    ? detectFullDrift(syncState, diskContents, remoteContents)
    : detectDrift(syncState, diskContents)

  logger.debug('status checked', {driftCount: summary.files.length, hasRemote: !!remoteContents})
  displayDrift(summary)
}

async function fetchRemoteContents(config: ProjectConfig): Promise<Record<string, string> | null> {
  if (config.sources.length === 0) return null

  try {
    const assistantDefs = config.assistants.map((a) => getAssistant(a.id))
    const allResolved = []

    for (const source of config.sources) {
      const loader = getSourceLoader(source.type)
      const {localPath} = await loader.load(source)
      const sourceFiles = await collectFiles(localPath)
      const resolved = resolveTargets(sourceFiles, assistantDefs, source.name)
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
