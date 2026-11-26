import type {FormattingOptions, JSONPath, Node, ParseError} from 'jsonc-parser'
import {applyEdits, findNodeAtLocation, getNodeValue, modify, parseTree, printParseErrorCode} from 'jsonc-parser'

import {hashContent} from '@domain/sync/state'

/** One forge-owned location in a JSON/JSONC settings file: an object member, or an array entry found by identity. */
export type OwnedKey =
  {kind: 'member'; path: string[]} | {kind: 'entry'; path: string[]; field: string | null; id: string}

export interface KeyedValue {
  key: OwnedKey
  value: unknown
}

export const DRIFT_POLICIES = {BLOCK: 'block', OVERWRITE: 'overwrite', KEEP: 'keep'} as const
export type DriftPolicy = (typeof DRIFT_POLICIES)[keyof typeof DRIFT_POLICIES]

export const KEYED_MERGE_ERRORS = {
  UNPARSEABLE: 'unparseable',
  DUPLICATE_IDENTITY: 'duplicate-identity',
  MISSING_IDENTITY: 'missing-identity',
  DRIFT: 'drift',
  INVALID_KEY: 'invalid-key',
} as const
export type KeyedMergeErrorKind = (typeof KEYED_MERGE_ERRORS)[keyof typeof KEYED_MERGE_ERRORS]

export class KeyedMergeError extends Error {
  constructor(
    readonly kind: KeyedMergeErrorKind,
    message: string,
  ) {
    super(message)
    this.name = 'KeyedMergeError'
  }
}

const E = KEYED_MERGE_ERRORS
const fail = (kind: KeyedMergeErrorKind, message: string): never => {
  throw new KeyedMergeError(kind, message)
}
const IDENTIFIER = /^[A-Za-z_$][\w$-]*/
const BARE_ID = /^[\w.@:/+-]+$/

// ─── Key paths ──────────────────────────────────────────────────────────────

/** Canonical state key, e.g. `enabledPlugins["foo@bar"]`, `plugins[name=foo]`, `permissions.allow[="Bash(ls)"]`. */
export function formatOwnedKey(key: OwnedKey): string {
  const path = key.path
    .map((segment, index) =>
      IDENTIFIER.exec(segment)?.[0] === segment ? `${index ? '.' : ''}${segment}` : `[${JSON.stringify(segment)}]`,
    )
    .join('')
  if (key.kind === 'member') return path
  return `${path}[${key.field ?? ''}=${BARE_ID.test(key.id) ? key.id : JSON.stringify(key.id)}]`
}

export function parseOwnedKey(text: string): OwnedKey {
  const invalid = () => fail(E.INVALID_KEY, `Invalid owned key: ${JSON.stringify(text)}`)
  const path: string[] = []
  let i = 0
  const readString = (): string => {
    let end = i + 1
    while (end < text.length && text[end] !== '"') end += text[end] === '\\' ? 2 : 1
    if (end >= text.length) invalid()
    const value: unknown = JSON.parse(text.slice(i, end + 1))
    i = end + 1
    return value as string
  }
  while (i < text.length) {
    if (text.startsWith('["', i)) {
      i++
      path.push(readString())
      if (text[i++] !== ']') invalid()
      continue
    }
    if (text[i] === '[') {
      const equals = text.indexOf('=', i)
      const field = equals < 0 ? '' : text.slice(i + 1, equals)
      if (equals < 0 || (field && IDENTIFIER.exec(field)?.[0] !== field) || !path.length) invalid()
      i = equals + 1
      let id: string
      if (text[i] === '"') id = readString()
      else {
        const end = text.indexOf(']', i)
        id = end < 0 ? '' : text.slice(i, end)
        if (!BARE_ID.test(id)) invalid()
        i = end
      }
      if (text[i] !== ']' || i !== text.length - 1) invalid()
      return {kind: 'entry', path, field: field || null, id}
    }
    if (path.length && text[i++] !== '.') invalid()
    const segment = IDENTIFIER.exec(text.slice(i))?.[0]
    if (!segment) return invalid()
    path.push(segment)
    i += segment.length
  }
  if (!path.length) invalid()
  return {kind: 'member', path}
}

export function isOwnedKey(text: string): boolean {
  try {
    return formatOwnedKey(parseOwnedKey(text)) === text
  } catch {
    return false
  }
}

// ─── Values ─────────────────────────────────────────────────────────────────

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const sorted = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(sorted)
    : isObject(value)
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((key) => [key, sorted(value[key])]),
        )
      : value

const canonical = (value: unknown) => JSON.stringify(sorted(value))

/** Same sha256 as state file hashes, over canonical JSON so formatting and member order never count as drift. */
export const hashOwnedValue = (value: unknown) => hashContent(canonical(value))

const identityOf = (value: unknown, field: string | null): string | undefined => {
  if (field === null) return typeof value === 'string' ? value : undefined
  return isObject(value) && Object.hasOwn(value, field) && typeof value[field] === 'string' ? value[field] : undefined
}

// ─── Document access ────────────────────────────────────────────────────────

function parseDocument(text: string): Node {
  const errors: ParseError[] = []
  const root = parseTree(text, errors, {allowTrailingComma: true, disallowComments: false})
  if (errors.length)
    fail(
      E.UNPARSEABLE,
      `Unparseable settings file (${printParseErrorCode(errors[0].error)} at offset ${errors[0].offset}); fix it, then retry`,
    )
  if (root?.type !== 'object') fail(E.UNPARSEABLE, 'Unparseable settings file (the top level must be an object)')
  return root!
}

interface Located {
  found: boolean
  value?: unknown
  index?: number
}

function locate(root: Node, key: OwnedKey): Located {
  const name = formatOwnedKey(key)
  let node = root
  for (let i = 0; i < key.path.length; i++) {
    if (node.type !== 'object') fail(E.INVALID_KEY, `${name} needs an object at "${key.path.slice(0, i).join('.')}"`)
    const next = findNodeAtLocation(node, [key.path[i]])
    if (!next) return {found: false}
    node = next
  }
  if (key.kind === 'member') return {found: true, value: getNodeValue(node)}
  const array = formatOwnedKey({kind: 'member', path: key.path})
  if (node.type !== 'array') fail(E.INVALID_KEY, `Owned array ${array} is not an array`)
  const seen = new Map<string, number>()
  for (const [index, child] of (node.children ?? []).entries()) {
    const id = identityOf(getNodeValue(child), key.field)
    if (id === undefined)
      fail(
        E.MISSING_IDENTITY,
        `Entry ${index} of owned array ${array} has no ${key.field ? `string "${key.field}"` : 'string value'} identity`,
      )
    if (seen.has(id!))
      fail(E.DUPLICATE_IDENTITY, `Owned array ${array} has identity ${JSON.stringify(id)} more than once`)
    seen.set(id!, index)
  }
  const index = seen.get(key.id)
  return index === undefined ? {found: false} : {found: true, value: getNodeValue(node.children![index]), index}
}

function formattingOf(text: string): FormattingOptions {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const indent = /^([ \t]+)\S/m.exec(text)?.[1]
  return indent?.startsWith('\t')
    ? {insertSpaces: false, tabSize: 1, eol}
    : {insertSpaces: true, tabSize: indent?.length ?? 2, eol}
}

function rejectOverlaps(keys: Map<string, OwnedKey>): void {
  for (const [a, owner] of keys) {
    if (owner.kind !== 'member') continue
    for (const [b, other] of keys)
      if (a !== b && owner.path.length <= other.path.length && owner.path.every((s, i) => s === other.path[i]))
        fail(E.INVALID_KEY, `Owned keys overlap: ${a} contains ${b}`)
  }
}

// ─── Merge ──────────────────────────────────────────────────────────────────

export interface KeyedMergeInput {
  /** Current file text, or null when the file does not exist. */
  text: string | null
  /** State v3 `ownedKeys` from the last committed run: key → sha256 of the value forge wrote. */
  owned: Record<string, string>
  /** Everything forge should own after this run. Previously owned keys not listed here are removed. */
  desired: KeyedValue[]
  drift: DriftPolicy
}

export interface KeyedMergeResult {
  /** Whole new file text, or null when nothing changes. */
  content: string | null
  owned: Record<string, string>
  /** Owned keys changed externally (or user entries at a forge identity): overwritten, or released under KEEP. */
  drifted: string[]
}

/**
 * Applies forge's keys as targeted jsonc-parser edits. Comments, formatting, member order and every key forge
 * does not own are left as they are. Array entries are matched by identity, replaced whole and never deep-merged.
 */
export function mergeKeyed(input: KeyedMergeInput): KeyedMergeResult {
  let text = input.text ?? '{}'
  const desired = new Map<string, KeyedValue>()
  for (const item of input.desired) {
    const id = formatOwnedKey(item.key)
    if (desired.has(id)) fail(E.DUPLICATE_IDENTITY, `Forge declares ${id} more than once`)
    if (item.key.kind === 'entry' && identityOf(item.value, item.key.field) !== item.key.id)
      fail(E.MISSING_IDENTITY, `Value for ${id} does not carry its identity`)
    if (item.value === undefined) fail(E.INVALID_KEY, `Value for ${id} is undefined`)
    desired.set(id, item)
  }
  const keys = new Map<string, OwnedKey>(Object.keys(input.owned).map((id) => [id, parseOwnedKey(id)]))
  for (const [id, item] of desired) keys.set(id, item.key)
  rejectOverlaps(keys)

  const root = parseDocument(text)
  const drifted: string[] = []
  const current = new Map<string, Located>()
  for (const [id, key] of keys) {
    const located = locate(root, key)
    current.set(id, located)
    const previous = input.owned[id]
    if (located.found && (previous === undefined || hashOwnedValue(located.value) !== previous)) drifted.push(id)
  }
  if (drifted.length && input.drift === DRIFT_POLICIES.BLOCK)
    fail(
      E.DRIFT,
      `Forge-owned keys were changed outside forge: ${drifted.join(', ')}. Restore them, or re-run with --force to overwrite them`,
    )

  const formattingOptions = formattingOf(text)
  const edit = (path: JSONPath, value: unknown) => {
    text = applyEdits(text, modify(text, path, value, {formattingOptions}))
  }
  const owned: Record<string, string> = {}
  for (const [id, key] of keys) {
    if (input.drift === DRIFT_POLICIES.KEEP && drifted.includes(id)) continue
    const item = desired.get(id)
    const before = current.get(id)!
    if (item && before.found && canonical(before.value) === canonical(item.value)) {
      owned[id] = hashOwnedValue(item.value)
      continue
    }
    if (!item && !before.found) continue
    // Indices move after every edit, so re-locate in the current text.
    const now = locate(parseDocument(text), key)
    const target: JSONPath =
      key.kind === 'member' ? key.path : now.found ? [...key.path, now.index!] : [...key.path, -1]
    if (item) {
      const arrayMissing = key.kind === 'entry' && !locate(parseDocument(text), {kind: 'member', path: key.path}).found
      edit(arrayMissing ? key.path : target, arrayMissing ? [item.value] : item.value)
      owned[id] = hashOwnedValue(item.value)
    } else if (now.found) edit(target, undefined)
  }
  if (text === (input.text ?? '{}')) return {content: null, owned, drifted}
  if (input.text === null) text = text.endsWith('\n') ? text : `${text}${formattingOptions.eol}`
  return {content: text, owned, drifted}
}
