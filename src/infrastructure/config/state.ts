import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {dirname, join} from 'node:path'

import {z} from 'zod'

import {STATE_PATH} from '@domain/config/paths'
import type {SyncState} from '@domain/sync/state'
import {emptySyncState, SYNC_BASELINES} from '@domain/sync/state'

import {createConfinement} from '../fs/confinement'

const entrySchema = z.object({hash: z.string().regex(/^[a-f0-9]{64}$/), sourceName: z.string()}).strict()
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
const currentSchema = z
  .object({
    ...stateFields,
    version: z.literal(2),
    files: z.record(pathSchema, entrySchema.extend({baseline: z.enum(SYNC_BASELINES)}).strict()),
  })
  .strict()

export function parseSyncState(input: unknown): SyncState {
  const current = input && typeof input === 'object' && 'version' in input
  const parsed: SyncState = current ? currentSchema.parse(input) : legacySchema.parse(input)
  const files: SyncState['files'] = {}
  for (const [path, entry] of Object.entries(parsed.files)) {
    const key = path.replaceAll('\\', '/')
    if (Object.hasOwn(files, key)) throw new Error(`Competing tracked paths after separator normalization: ${key}`)
    files[key] = {...entry, baseline: entry.baseline ?? SYNC_BASELINES.LEGACY_UNKNOWN}
  }
  return {
    version: 2,
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
