import {readFile} from 'node:fs/promises'
import {join} from 'node:path'

import {z} from 'zod'

import type {PluginLock, PluginScope} from '@domain/plugins'
import {buildPluginLock, emptyPluginLock, PLUGIN_LOCK_VERSION, PLUGIN_SCOPES} from '@domain/plugins'

import {PluginLockError} from './errors'
import {PLUGIN_NAME, PLUGIN_NAME_MAX, SEMVER} from './manifest'

/** Relative to the project root (project scope) or home (user scope). */
export const PLUGIN_LOCK_PATHS: Record<PluginScope, string> = {
  [PLUGIN_SCOPES.PROJECT]: join('.crucible', 'forge.lock'),
  [PLUGIN_SCOPES.USER]: join('.crucible', 'forge', 'forge.lock'),
}

const hash = z.string().regex(/^[a-f0-9]{64}$/)
const entrySchema = z
  .object({
    name: z.string().max(PLUGIN_NAME_MAX).regex(PLUGIN_NAME),
    version: z.string().regex(SEMVER),
    source: z.discriminatedUnion('type', [
      z.object({type: z.literal('local'), path: z.string()}).strict(),
      z.object({type: z.literal('git'), url: z.string(), path: z.string().optional(), ref: z.string()}).strict(),
    ]),
    resolved: z
      .string()
      .regex(/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/)
      .optional(),
    contentHash: hash,
    outputs: z.record(z.string(), hash),
  })
  .strict()
const lockSchema = z
  .object({
    version: z.literal(PLUGIN_LOCK_VERSION),
    plugins: z
      .array(entrySchema)
      .refine((plugins) => new Set(plugins.map((p) => p.name)).size === plugins.length, 'duplicate plugin name'),
    variants: z.record(z.string(), z.string().regex(/^sha256:[a-f0-9]{64}$/)),
  })
  .strict()

export function parsePluginLock(text: string, path: string): PluginLock {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new PluginLockError(`${path} is not valid JSON; restore it from version control`)
  }
  const version = (raw as {version?: unknown} | null)?.version
  if (typeof version === 'number' && version > PLUGIN_LOCK_VERSION)
    throw new PluginLockError(`${path} has lock version ${version}, written by a newer forge; upgrade forge`)
  const parsed = lockSchema.safeParse(raw)
  if (!parsed.success)
    throw new PluginLockError(
      `${path} is invalid: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
    )
  return buildPluginLock(parsed.data.plugins)
}

export function serializePluginLock(lock: PluginLock): string {
  return JSON.stringify(buildPluginLock(lock.plugins), null, 2) + '\n'
}

export async function readPluginLock(path: string): Promise<PluginLock> {
  try {
    return parsePluginLock(await readFile(path, 'utf8'), path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyPluginLock()
    throw error
  }
}
