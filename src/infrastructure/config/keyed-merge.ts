import type {Node, ParseError} from 'jsonc-parser'
import {createScanner, getNodeValue, parseTree, printParseErrorCode} from 'jsonc-parser'

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
  DUPLICATE_KEY: 'duplicate-key',
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
const isIdentifier = (text: string) => IDENTIFIER.exec(text)?.[0] === text

// ─── Key paths ──────────────────────────────────────────────────────────────

/** Canonical state key, e.g. `enabledPlugins["foo@bar"]`, `plugins[name=foo]`, `permissions.allow[="Bash(ls)"]`. */
export function formatOwnedKey(key: OwnedKey): string {
  if (!key.path.length) fail(E.INVALID_KEY, 'An owned key needs a path')
  if (key.kind === 'entry' && key.field !== null && !isIdentifier(key.field))
    fail(E.INVALID_KEY, `Invalid identity field ${JSON.stringify(key.field)}`)
  const path = key.path
    .map((segment, index) => (isIdentifier(segment) ? `${index ? '.' : ''}${segment}` : `[${JSON.stringify(segment)}]`))
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
      if (equals < 0 || (field && !isIdentifier(field)) || !path.length) invalid()
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

const isComposite = (value: unknown) => typeof value === 'object' && value !== null && Object.keys(value).length > 0

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
  if (root?.type !== 'object')
    fail(E.UNPARSEABLE, 'Unparseable settings file (the top level must be an object); fix it, then retry')
  return root!
}

interface Located {
  found: boolean
  value?: unknown
  /** Container and index of the property or array element that holds the value. */
  container?: Node
  index?: number
  /** Deepest existing object and the path segments missing below it. */
  parent?: Node
  missing?: string[]
  /** Existing owned array with no entry of this identity. */
  array?: Node
}

/** jsonc-parser reports no error for duplicate names, and JSON.parse (what harnesses use) keeps the last one. */
function propertyOf(object: Node, name: string, owner: string): Node | undefined {
  const matches = (object.children ?? []).filter((property) => property.children?.[0]?.value === name)
  if (matches.length > 1)
    fail(E.DUPLICATE_KEY, `"${name}" appears more than once on the way to ${owner}; remove the duplicate, then retry`)
  return matches[0]
}

function locate(root: Node, key: OwnedKey): Located {
  const name = formatOwnedKey(key)
  let node = root
  for (let i = 0; i < key.path.length; i++) {
    if (node.type !== 'object')
      fail(
        E.INVALID_KEY,
        `${name} needs an object at ${formatOwnedKey({kind: 'member', path: key.path.slice(0, i)})}; make it an object or remove it, then retry`,
      )
    const property = propertyOf(node, key.path[i], name)
    if (!property) return {found: false, parent: node, missing: key.path.slice(i)}
    if (key.kind === 'member' && i === key.path.length - 1)
      return {
        found: true,
        value: getNodeValue(property.children![1]),
        container: node,
        index: node.children!.indexOf(property),
      }
    node = property.children![1]
  }
  const array = formatOwnedKey({kind: 'member', path: key.path})
  if (node.type !== 'array')
    fail(E.INVALID_KEY, `Owned array ${array} is not an array; make it an array or remove it, then retry`)
  const field = key.kind === 'entry' ? key.field : null
  const seen = new Map<string, number>()
  for (const [index, child] of (node.children ?? []).entries()) {
    const id = identityOf(getNodeValue(child), field)
    if (id === undefined)
      fail(
        E.MISSING_IDENTITY,
        `Entry ${index} of owned array ${array} has no ${field ? `string "${field}"` : 'string value'} identity; give every entry one, then retry`,
      )
    if (seen.has(id!))
      fail(
        E.DUPLICATE_IDENTITY,
        `Owned array ${array} has identity ${JSON.stringify(id)} more than once; keep one entry, then retry`,
      )
    seen.set(id!, index)
  }
  const index = key.kind === 'entry' ? seen.get(key.id) : undefined
  return index === undefined
    ? {found: false, array: node}
    : {found: true, value: getNodeValue(node.children![index]), container: node, index}
}

function rejectOverlaps(keys: Map<string, OwnedKey>): void {
  for (const [a, owner] of keys) {
    if (owner.kind !== 'member') continue
    for (const [b, other] of keys)
      if (a !== b && owner.path.length <= other.path.length && owner.path.every((s, i) => s === other.path[i]))
        fail(E.INVALID_KEY, `Owned keys overlap: ${a} contains ${b}`)
  }
}

// ─── Text edits ─────────────────────────────────────────────────────────────
// Own edits instead of jsonc-parser's modify(): modify reformats the whole touched line and inserts after a
// trailing comment, so user comments move onto forge's lines and are deleted with them.

// jsonc-parser's SyntaxKind is an ambient const enum, which isolated-module transpilers cannot inline.
const TOKEN = {COMMA: 5, LINE_COMMENT: 12, BLOCK_COMMENT: 13, LINE_BREAK: 14, TRIVIA: 15, EOF: 17} as const

interface Edit {
  offset: number
  length: number
  content: string
}
interface Style {
  unit: string
  eol: string
}

/** Edits at one offset land in list order, so they are applied last-first. */
const applyEdits = (text: string, edits: Edit[]) =>
  edits
    .map((edit, order) => ({edit, order}))
    .sort((a, b) => b.edit.offset - a.edit.offset || b.order - a.order)
    .reduce(
      (result, {edit}) => result.slice(0, edit.offset) + edit.content + result.slice(edit.offset + edit.length),
      text,
    )

const endOf = (node: Node) => node.offset + node.length
const isEol = (char: string | undefined) => char === '\n' || char === '\r'
const lineStart = (text: string, offset: number) => {
  while (offset > 0 && !isEol(text[offset - 1])) offset--
  return offset
}
const lineEnd = (text: string, offset: number) => {
  while (offset < text.length && !isEol(text[offset])) offset++
  return offset
}
const blank = (text: string) => /^[ \t]*$/.test(text)
const startsLine = (text: string, offset: number) => blank(text.slice(lineStart(text, offset), offset))
const indentAt = (text: string, offset: number) => /^[ \t]*/.exec(text.slice(lineStart(text, offset)))![0]

function styleOf(text: string): Style {
  // The first indented JSON token, so a ` * ` line inside a block comment cannot set the unit.
  const indent = /^([ \t]+)["{}[\]]/m.exec(text)?.[1]
  return {
    unit: indent?.startsWith('\t') ? '\t' : ' '.repeat(indent?.length ?? 2),
    eol: text.includes('\r\n') ? '\r\n' : '\n',
  }
}

function scanTokens(text: string, from: number) {
  const scanner = createScanner(text, false)
  scanner.setPosition(from)
  return scanner
}

/** First token after `offset` that is not whitespace or a comment, and whether a comment came before it. */
function nextToken(text: string, offset: number): {kind: number; offset: number; comment: boolean} {
  const scanner = scanTokens(text, offset)
  let comment = false
  for (;;) {
    const kind: number = scanner.scan()
    if (kind === TOKEN.LINE_COMMENT || kind === TOKEN.BLOCK_COMMENT) comment = true
    else if (kind !== TOKEN.TRIVIA && kind !== TOKEN.LINE_BREAK)
      return {kind, offset: scanner.getTokenOffset(), comment}
  }
}

function hasComment(text: string, from: number, to: number): boolean {
  const scanner = scanTokens(text, from)
  for (let kind: number = scanner.scan(); kind !== TOKEN.EOF && scanner.getTokenOffset() < to; kind = scanner.scan())
    if (kind === TOKEN.LINE_COMMENT || kind === TOKEN.BLOCK_COMMENT) return true
  return false
}

function render(value: unknown, indent: string, style: Style, multiline: boolean): string {
  const pretty = JSON.stringify(value, null, style.unit)
  if (multiline) return pretty.replaceAll('\n', style.eol + indent)
  return pretty
    .replace(/([{[])\n\s*/g, '$1')
    .replace(/\n\s*([}\]])/g, '$1')
    .replace(/\n\s*/g, ' ')
}

/** Appends an item, keeping the container's layout: own lines before a closing bracket on its own line, else inline. */
function insertEdits(
  text: string,
  container: Node,
  item: (indent: string, multiline: boolean) => string,
  style: Style,
): Edit[] {
  const children = container.children ?? []
  const close = endOf(container) - 1
  const inner = text.slice(container.offset + 1, close)
  if (!children.length && !inner.trim()) {
    if (container.parent && !/[\r\n]/.test(text))
      return [{offset: container.offset + 1, length: inner.length, content: item('', false)}]
    const indent = indentAt(text, container.offset)
    const child = indent + style.unit
    return [
      {
        offset: container.offset + 1,
        length: inner.length,
        content: style.eol + child + item(child, true) + style.eol + indent,
      },
    ]
  }
  const edits: Edit[] = []
  const last = children.at(-1)
  // Comma right after the value, before any trailing comment, so the comment stays on the user's line.
  const trailing = last !== undefined && nextToken(text, endOf(last)).kind === TOKEN.COMMA
  if (last && !trailing) edits.push({offset: endOf(last), length: 0, content: ','})
  const comma = trailing ? ',' : ''
  if (startsLine(text, close)) {
    const first = children[0]
    const indent =
      first && startsLine(text, first.offset) ? indentAt(text, first.offset) : indentAt(text, close) + style.unit
    edits.push({offset: lineStart(text, close), length: 0, content: indent + item(indent, true) + comma + style.eol})
  } else edits.push({offset: close, length: 0, content: (last ? ' ' : '') + item('', false) + comma})
  return edits
}

/** Deletes [start, end), taking the whole line when nothing else is on it. */
function deleteSpan(text: string, start: number, end: number): Edit {
  const from = lineStart(text, start)
  const to = lineEnd(text, end)
  if (blank(text.slice(from, start)) && blank(text.slice(end, to))) {
    const eol = text.startsWith('\r\n', to) ? 2 : to < text.length ? 1 : 0
    return {offset: from, length: to + eol - from, content: ''}
  }
  let stop = end
  while (text[stop] === ' ' || text[stop] === '\t') stop++
  return {offset: start, length: stop - start, content: ''}
}

/** Removes one property or element and exactly one separating comma, never a comment. */
function removeEdits(text: string, container: Node, index: number): Edit[] {
  const children = container.children!
  const node = children[index]
  const close = endOf(container) - 1
  if (
    children.length === 1 &&
    !hasComment(text, container.offset + 1, node.offset) &&
    !hasComment(text, endOf(node), close)
  )
    return [{offset: container.offset + 1, length: close - container.offset - 1, content: ''}]
  const after = nextToken(text, endOf(node))
  if (after.kind === TOKEN.COMMA && !after.comment) return [deleteSpan(text, node.offset, after.offset + 1)]
  if (after.kind === TOKEN.COMMA)
    return [{offset: after.offset, length: 1, content: ''}, deleteSpan(text, node.offset, endOf(node))]
  if (index === 0) return [deleteSpan(text, node.offset, endOf(node))]
  const comma = nextToken(text, endOf(children[index - 1]))
  if (!hasComment(text, comma.offset + 1, node.offset))
    return [{offset: comma.offset, length: endOf(node) - comma.offset, content: ''}]
  return [{offset: comma.offset, length: 1, content: ''}, deleteSpan(text, node.offset, endOf(node))]
}

function setEdits(text: string, key: OwnedKey, value: unknown, located: Located, style: Style): Edit[] {
  if (located.found) {
    const container = located.container!
    const holder = container.children![located.index!]
    const target = key.kind === 'member' ? holder.children![1] : holder
    const old = text.slice(target.offset, endOf(target))
    const multiline =
      old.includes('\n') ||
      (isComposite(value) &&
        !isComposite(getNodeValue(target)) &&
        text.slice(container.offset, endOf(container)).includes('\n'))
    return [
      {
        offset: target.offset,
        length: target.length,
        content: render(value, indentAt(text, target.offset), style, multiline),
      },
    ]
  }
  if (located.array)
    return insertEdits(text, located.array, (indent, multiline) => render(value, indent, style, multiline), style)
  const [first, ...rest] = located.missing!
  const nested = rest.reduceRight<unknown>(
    (inner, segment) => ({[segment]: inner}),
    key.kind === 'member' ? value : [value],
  )
  return insertEdits(
    text,
    located.parent!,
    (indent, multiline) => `${JSON.stringify(first)}: ${render(nested, indent, style, multiline)}`,
    style,
  )
}

/**
 * Removes containers on the key's path that the removal left empty, so an add then remove round trip restores the
 * original bytes. An empty settings object means the same as an absent one; a container holding a comment stays.
 */
function pruneEmpty(text: string, key: OwnedKey): string {
  for (let depth = key.kind === 'member' ? key.path.length - 1 : key.path.length; depth > 0; depth--) {
    const now = locate(parseDocument(text), {kind: 'member', path: key.path.slice(0, depth)})
    if (!now.found) return text
    const holder = now.container!.children![now.index!]
    const value = holder.children![1]
    if (value.children?.length || !/^[{[]\s*[}\]]$/.test(text.slice(value.offset, endOf(value)))) return text
    text = applyEdits(text, removeEdits(text, now.container!, now.index!))
  }
  return text
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
  /** Keys that differ from what forge wrote and what it wants now: overwritten under OVERWRITE, released under KEEP. */
  drifted: string[]
}

/**
 * Applies forge's keys as targeted text edits. Comments, formatting, member order and every key forge does not
 * own keep their bytes. Array entries are matched by identity, replaced whole and never deep-merged.
 */
export function mergeKeyed(input: KeyedMergeInput): KeyedMergeResult {
  const original = input.text ?? '{}'
  // Windows editors often save settings with a BOM, which jsonc-parser reports as an invalid symbol.
  const bom = original.startsWith('\uFEFF') ? '\uFEFF' : ''
  let text = original.slice(bom.length)
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
    const item = desired.get(id)
    // A value already equal to forge's would not be overwritten, so, like equal file bytes, it is no conflict.
    const wanted = item !== undefined && located.found && canonical(located.value) === canonical(item.value)
    if (located.found && !wanted && hashOwnedValue(located.value) !== input.owned[id]) drifted.push(id)
  }
  if (drifted.length && input.drift === DRIFT_POLICIES.BLOCK)
    fail(
      E.DRIFT,
      `Forge-owned keys were changed outside forge: ${drifted.join(', ')}. Restore them, or re-run with --force to overwrite them`,
    )

  const style = styleOf(text)
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
    // Offsets move after every edit, so locate again in the current text.
    const now = locate(parseDocument(text), key)
    if (item) {
      text = applyEdits(text, setEdits(text, key, item.value, now, style))
      owned[id] = hashOwnedValue(item.value)
    } else if (now.found) {
      text = applyEdits(text, removeEdits(text, now.container!, now.index!))
      text = pruneEmpty(text, key)
    }
  }
  text = bom + text
  if (text === original) return {content: null, owned, drifted}
  if (input.text === null && !text.endsWith('\n')) text += style.eol
  return {content: text, owned, drifted}
}
