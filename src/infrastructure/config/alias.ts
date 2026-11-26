import {readFile, writeFile} from 'node:fs/promises'

import {parse as parseYaml} from 'yaml'

import * as renderer from '../cli/renderer'

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

const CANONICAL_KEY_LINE = /^assistants:(?=[ \t\r\n#]|$)/

function topLevelKeys(text: string): string[] {
  try {
    const parsed: unknown = parseYaml(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? Object.keys(parsed) : []
  } catch {
    return []
  }
}

/**
 * Renames the canonical top-level `assistants:` key line and nothing else. The text is a latin1 view of the file
 * bytes, so the result maps back to the original bytes exactly apart from that key.
 */
export function renameAssistantsKey(text: string): {text: string; status: AliasStatus} {
  const keys = topLevelKeys(Buffer.from(text, 'latin1').toString('utf-8'))
  if (!keys.includes('assistants') || keys.includes('harnesses')) return {text, status: ALIAS_STATUSES.NONE}
  const lines = text.split(/(?<=\n)/)
  const matches = lines.flatMap((line, index) => (CANONICAL_KEY_LINE.test(line) ? [index] : []))
  if (matches.length !== 1) return {text, status: ALIAS_STATUSES.NON_CANONICAL}
  lines[matches[0]] = lines[matches[0]].replace(CANONICAL_KEY_LINE, 'harnesses:')
  return {text: lines.join(''), status: ALIAS_STATUSES.CONVERTED}
}

/**
 * Converts the `assistants:` read alias as its own write, before any reserializing config write, so the rename
 * alone never drops user comments. Returns the converted file text, or null when nothing was written.
 */
export async function convertAssistantsAlias(configPath: string): Promise<string | null> {
  let bytes: Buffer
  try {
    bytes = await readFile(configPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
  const {text, status} = renameAssistantsKey(bytes.toString('latin1'))
  if (status === ALIAS_STATUSES.NON_CANONICAL) renderer.renderWarning(ALIAS_MESSAGES.nonCanonical)
  if (status !== ALIAS_STATUSES.CONVERTED) return null
  const converted = Buffer.from(text, 'latin1')
  await writeFile(configPath, converted)
  return converted.toString('utf-8')
}
