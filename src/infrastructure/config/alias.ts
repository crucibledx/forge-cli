import {readFile} from 'node:fs/promises'
import {join} from 'node:path'

import {isMap, isScalar, parseDocument, Scalar} from 'yaml'

import {CONFIG_PATH} from '@domain/config/paths'

import * as renderer from '../cli/renderer'
import {prepareTransaction, transactionIO} from '../fs/transaction'

export const ALIAS_STATUSES = {
  CONVERTED: 'converted',
  NON_CANONICAL: 'non-canonical',
  NONE: 'none',
} as const
export type AliasStatus = (typeof ALIAS_STATUSES)[keyof typeof ALIAS_STATUSES]

export const ALIAS_MESSAGES = {
  nonCanonical:
    'Config spells the old `assistants:` key in a non-standard way, so forge still reads it as `harnesses:` and left it unchanged. Rename it to `harnesses:` by hand.',
}

const OLD_KEY = 'assistants'
const NEW_KEY = 'harnesses'

/**
 * Renames the top-level `assistants:` key of a config file when it is spelled canonically: a plain key at column 0
 * of a block mapping, directly followed by `:`. Only those key bytes change. Any other spelling, and files that are
 * not valid UTF-8, are reported as non-canonical and left as they are.
 */
export function renameAssistantsKey(bytes: Uint8Array): {bytes: Buffer; status: AliasStatus} {
  const original = Buffer.from(bytes)
  const unchanged = (status: AliasStatus) => ({bytes: original, status})
  const text = original.toString('utf-8')
  const doc = parseDocument(text)
  const contents = doc.contents
  if (doc.errors.length || !isMap(contents)) return unchanged(ALIAS_STATUSES.NONE)
  const pair = (name: string) => contents.items.find((item) => isScalar(item.key) && item.key.value === name)
  const alias = pair(OLD_KEY)
  if (!alias || pair(NEW_KEY)) return unchanged(ALIAS_STATUSES.NONE)
  const key = alias.key as Scalar
  const start = key.range?.[0]
  const canonical =
    start !== undefined &&
    !contents.flow &&
    key.type === Scalar.PLAIN &&
    (start === 0 || text[start - 1] === '\n') &&
    text.startsWith(`${OLD_KEY}:`, start) &&
    Buffer.from(text, 'utf-8').equals(original)
  if (!canonical) return unchanged(ALIAS_STATUSES.NON_CANONICAL)
  const offset = Buffer.byteLength(text.slice(0, start))
  return {
    bytes: Buffer.concat([
      original.subarray(0, offset),
      Buffer.from(NEW_KEY),
      original.subarray(offset + OLD_KEY.length),
    ]),
    status: ALIAS_STATUSES.CONVERTED,
  }
}

export interface AliasConversion {
  status: AliasStatus
  /** The config file text after the conversion. */
  text: string
  /** Restores the original bytes; set only when the conversion wrote. */
  undo?: () => Promise<void>
}

async function replaceConfig(projectRoot: string, content: Uint8Array, fs: typeof transactionIO): Promise<void> {
  await (await prepareTransaction(projectRoot, [{path: CONFIG_PATH, content}], fs)).commit()
}

/**
 * Converts the `assistants:` read alias as its own atomic, access-preserving write, before any reserializing config
 * write, so the rename alone never drops user comments. Returns null when there is no config file.
 */
export async function convertAssistantsAlias(
  projectRoot: string,
  fs: typeof transactionIO = transactionIO,
): Promise<AliasConversion | null> {
  let original: Buffer
  try {
    original = await readFile(join(projectRoot, CONFIG_PATH))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  const {bytes, status} = renameAssistantsKey(original)
  if (status === ALIAS_STATUSES.NON_CANONICAL) renderer.renderWarning(ALIAS_MESSAGES.nonCanonical)
  if (status !== ALIAS_STATUSES.CONVERTED) return {status, text: original.toString('utf-8')}
  await replaceConfig(projectRoot, bytes, fs)
  return {status, text: bytes.toString('utf-8'), undo: () => replaceConfig(projectRoot, original, fs)}
}
