import {readFile} from 'node:fs/promises'
import {join} from 'node:path'

import {isMap, isScalar, parseDocument, Scalar} from 'yaml'

import {CONFIG_PATH} from '@domain/config/paths'

import * as renderer from '../cli/renderer'
import {prepareTransaction, reportUnrestoredRecovery, transactionIO} from '../fs/transaction'

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
 * Maps an offset in the lossily decoded text back to a byte offset, decoding with the same algorithm so invalid
 * bytes elsewhere in the file do not shift the result. Undefined when the offset falls inside a multibyte character.
 */
function byteOffsetOf(bytes: Uint8Array, charOffset: number): number | undefined {
  const decoder = new TextDecoder('utf-8')
  let chars = 0
  let index = 0
  while (chars < charOffset && index < bytes.length) {
    chars += decoder.decode(bytes.subarray(index, index + 1), {stream: true}).length
    index++
  }
  return chars === charOffset ? index : undefined
}

/**
 * Renames the top-level `assistants:` key of a config file when it is spelled canonically: a plain key at column 0
 * of a block mapping, directly followed by `:`. Only those key bytes change; every other byte is preserved,
 * including comment bytes that are not valid UTF-8. Any other spelling is non-canonical and left as it is.
 */
export function renameAssistantsKey(bytes: Uint8Array): {bytes: Buffer; status: AliasStatus} {
  const original = Buffer.from(bytes)
  const unchanged = (status: AliasStatus) => ({bytes: original, status})
  // Lossy like the loader: invalid bytes decode to U+FFFD for parsing; surgery happens on the original bytes.
  const text = new TextDecoder('utf-8').decode(original)
  const doc = parseDocument(text)
  const contents = doc.contents
  if (doc.errors.length || !isMap(contents)) return unchanged(ALIAS_STATUSES.NONE)
  const pair = (name: string) => contents.items.find((item) => isScalar(item.key) && item.key.value === name)
  const alias = pair(OLD_KEY)
  if (!alias || pair(NEW_KEY)) return unchanged(ALIAS_STATUSES.NONE)
  const key = alias.key as Scalar
  const start = key.range?.[0]
  if (
    start === undefined ||
    contents.flow ||
    key.type !== Scalar.PLAIN ||
    (start !== 0 && text[start - 1] !== '\n') ||
    !text.startsWith(`${OLD_KEY}:`, start)
  ) {
    return unchanged(ALIAS_STATUSES.NON_CANONICAL)
  }
  const offset = byteOffsetOf(original, start)
  if (
    offset === undefined ||
    (offset !== 0 && original[offset - 1] !== 0x0a) ||
    !original.subarray(offset, offset + OLD_KEY.length).equals(Buffer.from(OLD_KEY))
  ) {
    return unchanged(ALIAS_STATUSES.NON_CANONICAL)
  }
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
  try {
    await (await prepareTransaction(projectRoot, [{path: CONFIG_PATH, content}], fs)).commit()
  } catch (error) {
    reportUnrestoredRecovery(error)
    throw error
  }
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
