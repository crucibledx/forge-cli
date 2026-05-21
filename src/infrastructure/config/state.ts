import {existsSync} from 'node:fs'
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {dirname, join} from 'node:path'

import type {SyncState} from '@domain/sync/state'
import {emptySyncState} from '@domain/sync/state'

const CRUCIBLE_DIR = '.crucible'
const STATE_FILE = 'sync-state.json'

export function getSyncStatePath(projectRoot: string): string {
  return join(projectRoot, CRUCIBLE_DIR, STATE_FILE)
}

export async function loadSyncState(projectRoot: string): Promise<SyncState> {
  const statePath = getSyncStatePath(projectRoot)

  if (!existsSync(statePath)) {
    return emptySyncState()
  }

  const raw = await readFile(statePath, 'utf-8')
  return JSON.parse(raw) as SyncState
}

export async function writeSyncState(projectRoot: string, state: SyncState): Promise<void> {
  const statePath = getSyncStatePath(projectRoot)
  await mkdir(dirname(statePath), {recursive: true})
  await writeFile(statePath, JSON.stringify(state, null, 2) + '\n', 'utf-8')
}
