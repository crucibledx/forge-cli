import type {SyncState} from '@domain/sync/state'
import {isKeyedEntry} from '@domain/sync/state'
import {DRIFT_POLICIES, mergeKeyed} from '@infrastructure/config/keyed-merge'
import {createFileReader} from '@infrastructure/fs/reader'
import type {FileOperation} from '@infrastructure/fs/transaction'
import {prepareTransaction} from '@infrastructure/fs/transaction'

export interface OwnedKeyRemoval {
  operations: FileOperation[]
  /** Owned keys changed outside forge; they now belong to the user and stay. */
  kept: string[]
}

/** Read-only: plans removing every forge-owned settings key recorded in state, refusing unparseable files. */
export async function planOwnedKeyRemoval(root: string, state: SyncState): Promise<OwnedKeyRemoval> {
  const keyed = Object.entries(state.files).filter(([, entry]) => isKeyedEntry(entry))
  if (!keyed.length) return {operations: [], kept: []}
  const read = await createFileReader(root)
  const operations: FileOperation[] = []
  const kept: string[] = []
  for (const [path, entry] of keyed) {
    const existing = await read(path)
    if (existing === null) continue
    try {
      const result = mergeKeyed({
        text: existing.toString('utf8'),
        owned: entry.ownedKeys!,
        desired: [],
        drift: DRIFT_POLICIES.KEEP,
      })
      kept.push(...result.drifted.map((key) => `${path} ${key}`))
      if (result.content !== null) operations.push({path, content: result.content, expect: existing})
    } catch (error) {
      throw new Error(`${path}: ${error instanceof Error ? error.message : String(error)}`, {cause: error})
    }
  }
  return {operations, kept}
}

/** Writes the planned removals as one transaction: all settings files change, or none do. */
export async function commitOwnedKeyRemoval(root: string, removal: OwnedKeyRemoval): Promise<number> {
  if (removal.operations.length) await (await prepareTransaction(root, removal.operations)).commit()
  return removal.operations.length
}
