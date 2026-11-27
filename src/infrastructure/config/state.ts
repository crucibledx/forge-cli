import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {dirname, join} from 'node:path'

import {z} from 'zod'

import {STATE_PATH} from '@domain/config/paths'
import type {SyncState} from '@domain/sync/state'
import {emptySyncState, SYNC_BASELINES, SYNC_STATE_VERSION} from '@domain/sync/state'

import {createConfinement} from '../fs/confinement'
import {isOwnedKey} from './keyed-merge'

export class StateVersionError extends Error {
  constructor(version: number) {
    super(
      `${STATE_PATH} has state version ${version}, written by a newer forge; this forge reads versions up to ${SYNC_STATE_VERSION}. Upgrade forge, then retry. Nothing was changed.`,
    )
    this.name = 'StateVersionError'
  }
}

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/)
const entrySchema = z.object({hash: hashSchema, sourceName: z.string()}).strict()
const pathSchema = z
  .string()
  .min(1)
  .refine(
    (path) =>
      !/^(?:[/\\]|[a-z]:)/i.test(path) &&
      !path.split(/[/\\]/).some((p) => p === '..' || p === '.') &&
      !path.includes('\0'),
    'Invalid tracked path',
  )
const stateFields = {
  lastSync: z.string().refine((value) => value === '' || Number.isFinite(Date.parse(value)), 'Invalid lastSync'),
}
const legacySchema = z.object({...stateFields, files: z.record(pathSchema, entrySchema)}).strict()
const baselineEntrySchema = entrySchema.extend({baseline: z.enum(SYNC_BASELINES)}).strict()
/** One strict schema per version; a CLI refuses any version it has no schema for. */
export const STATE_SCHEMAS = {
  2: z.object({...stateFields, version: z.literal(2), files: z.record(pathSchema, baselineEntrySchema)}).strict(),
  3: z
    .object({
      ...stateFields,
      version: z.literal(3),
      files: z.record(
        pathSchema,
        baselineEntrySchema
          .extend({ownedKeys: z.record(z.string().refine(isOwnedKey, 'Invalid owned key'), hashSchema).optional()})
          .strict(),
      ),
    })
    .strict(),
}

export function parseSyncState(input: unknown): SyncState {
  // Zod's record parser skips this own key before validating its value.
  // Refuse the entire state rather than silently losing retained ownership.
  if (input && typeof input === 'object' && 'files' in input) {
    const files = input.files
    if (files && typeof files === 'object' && Object.hasOwn(files, '__proto__'))
      throw new Error('Unsupported tracked state path: __proto__')
    for (const entry of files && typeof files === 'object' ? Object.values(files) : [])
      if (entry && typeof entry === 'object' && 'ownedKeys' in entry) {
        const keys = entry.ownedKeys
        if (keys && typeof keys === 'object' && Object.hasOwn(keys, '__proto__'))
          throw new Error('Unsupported owned key in state: __proto__')
      }
  }
  const current = input && typeof input === 'object' && 'version' in input
  if (current && typeof input.version === 'number' && input.version > SYNC_STATE_VERSION)
    throw new StateVersionError(input.version)
  const parsed: SyncState = !current
    ? legacySchema.parse(input)
    : (input.version === 2 ? STATE_SCHEMAS[2] : STATE_SCHEMAS[3]).parse(input)
  const files: SyncState['files'] = {}
  for (const [path, entry] of Object.entries(parsed.files)) {
    // Forge writes "/" keys, and older Windows builds wrote "\"-only keys. On POSIX a key with both can name a
    // literal-backslash file, and rewriting it would hand ownership (and later deletion) to a different file.
    const key = path.replaceAll('\\', '/')
    if (process.platform !== 'win32' && path.includes('/') && path.includes('\\'))
      throw new Error(
        `Ambiguous tracked backslash path on POSIX: ${path}. It can name a file with a backslash in its name or the nested file ${key}, so nothing was changed. Keep both files. In ${STATE_PATH}, rename this entry to ${key} only if Forge installed the nested file; otherwise remove the entry. Then retry.`,
      )
    if (Object.hasOwn(files, key)) throw new Error(`Competing tracked paths after separator normalization: ${key}`)
    const {ownedKeys, ...file} = entry
    files[key] = {
      ...file,
      baseline: entry.baseline ?? SYNC_BASELINES.LEGACY_UNKNOWN,
      ...(ownedKeys && Object.keys(ownedKeys).length ? {ownedKeys} : {}),
    }
  }
  // Older state upgrades in memory only; the v3 bytes are written by the next committed transaction.
  return {
    version: SYNC_STATE_VERSION,
    lastSync: parsed.lastSync,
    files,
  }
}

export function getSyncStatePath(projectRoot: string): string {
  return join(projectRoot, STATE_PATH)
}

export async function loadSyncState(projectRoot: string): Promise<SyncState> {
  const statePath = await (await createConfinement(projectRoot)).resolve(STATE_PATH)
  try {
    return parseSyncState(JSON.parse(await readFile(statePath, 'utf-8')))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptySyncState()
    throw error
  }
}

export async function writeSyncState(projectRoot: string, state: SyncState): Promise<void> {
  const statePath = getSyncStatePath(projectRoot)
  await mkdir(dirname(statePath), {recursive: true})
  await writeFile(statePath, JSON.stringify(state, null, 2) + '\n', 'utf-8')
}
