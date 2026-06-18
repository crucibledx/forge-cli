import * as prompts from '@infrastructure/cli/prompts'
import * as renderer from '@infrastructure/cli/renderer'
import {loadProjectConfig, loadSyncState, removeCrucibleDir} from '@infrastructure/config'
import io from '@infrastructure/io'
import {createFileLogger} from '@infrastructure/logger'
import {getSchedulerBackend} from '@infrastructure/scheduler'

import {deleteSourceFiles} from '../shared/source.cleanup'
import {UNINSTALL_MESSAGES as M} from './messages'

export async function runUninstall(): Promise<void> {
  const logger = createFileLogger()
  const projectRoot = io.resolveProjectRoot()
  const config = await loadProjectConfig(projectRoot)

  if (!config) {
    renderer.renderError(M.errors.noConfig, M.errors.noConfigHint)
    process.exit(1)
  }

  prompts.intro(M.intro)

  const confirmed = await prompts.confirm({
    message: M.confirm,
    initialValue: false,
  })
  if (!confirmed) {
    prompts.outro(M.cancelled)
    return
  }

  // 1. Uninstall scheduler
  await uninstallScheduler(projectRoot)

  // 2. Remove synced files
  await removeSyncedFiles(projectRoot)

  // 3. Remove .crucible directory
  await removeCrucibleDir(projectRoot)
  renderer.renderSuccess(M.configRemoved)

  logger.info('uninstall completed', {projectRoot})
  prompts.outro(M.done)
}

async function uninstallScheduler(projectRoot: string): Promise<void> {
  const backend = getSchedulerBackend()
  const installed = await backend.isInstalled(projectRoot)

  if (!installed) {
    renderer.renderDim(M.schedulerNotInstalled)
    return
  }

  try {
    await backend.uninstall(projectRoot)
    renderer.renderSuccess(M.schedulerRemoved)
  } catch {
    renderer.renderDim(M.schedulerNotInstalled)
  }
}

async function removeSyncedFiles(projectRoot: string): Promise<void> {
  const syncState = await loadSyncState(projectRoot)
  const allFiles = Object.keys(syncState.files)

  if (allFiles.length === 0) {
    renderer.renderDim(M.syncedFilesNone)
    return
  }

  const {cleaned} = await deleteSourceFiles(projectRoot, allFiles)
  renderer.renderSuccess(M.syncedFilesRemoved(cleaned))
}
