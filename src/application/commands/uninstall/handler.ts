import type {SyncState} from '@domain/sync/state'
import {isKeyedEntry} from '@domain/sync/state'
import * as prompts from '@infrastructure/cli/prompts'
import * as renderer from '@infrastructure/cli/renderer'
import {loadProjectConfig, loadSyncState, removeCrucibleDir} from '@infrastructure/config'
import io from '@infrastructure/io'
import {createFileLogger} from '@infrastructure/logger'
import {getSchedulerBackend} from '@infrastructure/scheduler'

import {commitOwnedKeyRemoval, planOwnedKeyRemoval} from '../shared/keyed.cleanup'
import {deleteSourceFiles} from '../shared/source.cleanup'
import {CommandError} from '../types'
import {UNINSTALL_MESSAGES as M} from './messages'

export async function runUninstall(): Promise<void> {
  const logger = createFileLogger()
  const projectRoot = io.resolveProjectRoot()
  const config = await loadProjectConfig(projectRoot)

  if (!config) {
    throw new CommandError(M.errors.noConfig, M.errors.noConfigHint)
  }
  // Unreadable or ambiguous tracked state must refuse before the prompt and before any scheduler or file change.
  const syncState = await loadSyncState(projectRoot)
  await planOwnedKeyRemoval(projectRoot, syncState)

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

  // 2. Remove forge-owned settings keys, planned again because the files may have changed during the prompt.
  //    Before synced files, so a refused removal leaves the install whole.
  const keyRemoval = await planOwnedKeyRemoval(projectRoot, syncState)
  const settingsFiles = await commitOwnedKeyRemoval(projectRoot, keyRemoval)
  if (settingsFiles) renderer.renderSuccess(M.ownedKeysRemoved(settingsFiles))
  keyRemoval.kept.forEach((key) => renderer.renderWarning(M.ownedKeyKept(key)))

  // 3. Remove synced files
  await removeSyncedFiles(projectRoot, syncState)

  // 4. Remove .crucible directory
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

async function removeSyncedFiles(projectRoot: string, syncState: SyncState): Promise<void> {
  const allFiles = Object.entries(syncState.files)
    .filter(([, entry]) => !isKeyedEntry(entry))
    .map(([path]) => path)

  if (allFiles.length === 0) {
    renderer.renderDim(M.syncedFilesNone)
    return
  }

  const {cleaned} = await deleteSourceFiles(projectRoot, allFiles)
  renderer.renderSuccess(M.syncedFilesRemoved(cleaned))
}
