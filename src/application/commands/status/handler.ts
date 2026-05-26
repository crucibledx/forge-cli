import {detectDrift} from '@domain/sync/drift'
import * as renderer from '@infrastructure/cli/renderer'
import {loadSyncState} from '@infrastructure/config'
import {readDiskContents} from '@infrastructure/fs'
import io from '@infrastructure/io'

import {displayDrift} from './display'
import {STATUS_MESSAGES as M} from './messages'
import type {StatusCommandAction} from './types'

export const runStatus: StatusCommandAction = async () => {
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

  const diskContents = await readDiskContents(projectRoot, syncState)
  const summary = detectDrift(syncState, diskContents)

  displayDrift(summary)
}
