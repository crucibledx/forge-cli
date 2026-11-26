import {describe, expect, it} from 'bun:test'
import {parse} from 'jsonc-parser'

import type {KeyedMergeInput, KeyedValue, OwnedKey} from './keyed-merge'
import {
  DRIFT_POLICIES,
  formatOwnedKey,
  hashOwnedValue,
  isOwnedKey,
  KEYED_MERGE_ERRORS,
  KeyedMergeError,
  mergeKeyed,
  parseOwnedKey,
} from './keyed-merge'

const member = (...path: string[]): OwnedKey => ({kind: 'member', path})
const entry = (path: string[], field: string | null, id: string): OwnedKey => ({kind: 'entry', path, field, id})
const marketplace = member('extraKnownMarketplaces', 'crucible-forge-user')
const enabled = member('enabledPlugins', 'foo@crucible-forge-user')
const forgeValues: KeyedValue[] = [
  {key: marketplace, value: {source: {source: 'directory', path: '/cache'}}},
  {key: enabled, value: true},
]
const ownedOf = (values: KeyedValue[]) =>
  Object.fromEntries(values.map((item) => [formatOwnedKey(item.key), hashOwnedValue(item.value)]))
const merge = (input: Partial<KeyedMergeInput> & {text: string | null}) =>
  mergeKeyed({owned: {}, desired: [], drift: DRIFT_POLICIES.BLOCK, ...input})
const errorKind = (run: () => unknown) => {
  try {
    run()
  } catch (error) {
    return error instanceof KeyedMergeError ? error.kind : 'other'
  }
  return 'none'
}

const userSettings = `{
\t// user comment kept verbatim
\t"model": "opus", /* inline */
\t"enabledPlugins": {
\t\t"mine@team": false,
\t},
}
`

describe('BR-11 keyed merge preserves user content (0003-AC-11)', () => {
  it('adds owned members as targeted edits, keeping comments, indentation and sibling keys', () => {
    const result = merge({text: userSettings, desired: forgeValues})
    const content = result.content!
    expect(content).toContain('\t// user comment kept verbatim\n\t"model": "opus", /* inline */')
    expect(content).toContain('\t\t"mine@team": false,')
    expect(content).not.toMatch(/^ +"/m)
    expect(parse(content, [], {allowTrailingComma: true})).toEqual({
      model: 'opus',
      enabledPlugins: {'mine@team': false, 'foo@crucible-forge-user': true},
      extraKnownMarketplaces: {'crucible-forge-user': {source: {source: 'directory', path: '/cache'}}},
    })
    expect(result.owned).toEqual(ownedOf(forgeValues))
    expect(merge({text: content, owned: result.owned, desired: forgeValues})).toEqual({
      content: null,
      owned: result.owned,
      drifted: [],
    })
  })

  it('creates a missing file with only forge keys', () => {
    const result = merge({text: null, desired: forgeValues})
    expect(result.content!.endsWith('\n')).toBe(true)
    expect(JSON.parse(result.content!)).toEqual({
      extraKnownMarketplaces: {'crucible-forge-user': {source: {source: 'directory', path: '/cache'}}},
      enabledPlugins: {'foo@crucible-forge-user': true},
    })
    expect(merge({text: null, desired: []}).content).toBeNull()
  })

  it('removes only previously owned keys and leaves user siblings', () => {
    const installed = merge({text: userSettings, desired: forgeValues})
    const removed = merge({text: installed.content, owned: installed.owned, desired: [forgeValues[0]]})
    expect(parse(removed.content!, [], {allowTrailingComma: true}).enabledPlugins).toEqual({'mine@team': false})
    expect(removed.content).toContain('// user comment kept verbatim')
    expect(removed.owned).toEqual(ownedOf([forgeValues[0]]))
  })

  it.each(['{ "a": ', '[]', 'null', ''])('blocks an unparseable settings file with a named error: %p', (text) => {
    expect(errorKind(() => merge({text, desired: forgeValues}))).toBe(KEYED_MERGE_ERRORS.UNPARSEABLE)
    expect(() => merge({text, desired: forgeValues})).toThrow('Unparseable settings file')
  })

  it('blocks external edits to an owned key without --force, naming every drifted key', () => {
    const installed = merge({text: userSettings, desired: forgeValues})
    const edited = installed.content!.replace('"foo@crucible-forge-user": true', '"foo@crucible-forge-user": false')
    const input = {text: edited, owned: installed.owned, desired: forgeValues}
    expect(errorKind(() => merge(input))).toBe(KEYED_MERGE_ERRORS.DRIFT)
    expect(() => merge(input)).toThrow('enabledPlugins["foo@crucible-forge-user"]')
    expect(() => merge(input)).toThrow('--force')
    const forced = merge({...input, drift: DRIFT_POLICIES.OVERWRITE})
    expect(forced.drifted).toEqual(['enabledPlugins["foo@crucible-forge-user"]'])
    expect(forced.content).toBe(installed.content)
  })

  it('treats formatting or member-order changes inside an owned value as unchanged', () => {
    const installed = merge({text: null, desired: forgeValues})
    const reformatted = installed.content!.replace(
      /\{\s*"source":\s*"directory",\s*"path":\s*"\/cache"\s*\}/,
      '{"path": "/cache",   "source": "directory"}',
    )
    expect(reformatted).not.toBe(installed.content)
    expect(merge({text: reformatted, owned: installed.owned, desired: forgeValues}).content).toBeNull()
  })

  it('treats a user value at a forge key it never owned as drift', () => {
    const text = '{"enabledPlugins": {"foo@crucible-forge-user": true}}'
    expect(errorKind(() => merge({text, desired: [forgeValues[1]]}))).toBe(KEYED_MERGE_ERRORS.DRIFT)
  })

  it('KEEP releases drifted keys instead of removing them', () => {
    const installed = merge({text: userSettings, desired: forgeValues})
    const edited = installed.content!.replace('"foo@crucible-forge-user": true', '"foo@crucible-forge-user": false')
    const kept = merge({text: edited, owned: installed.owned, desired: [], drift: DRIFT_POLICIES.KEEP})
    expect(kept.drifted).toEqual(['enabledPlugins["foo@crucible-forge-user"]'])
    expect(kept.owned).toEqual({})
    const value = parse(kept.content!, [], {allowTrailingComma: true})
    expect(value.enabledPlugins).toEqual({'mine@team': false, 'foo@crucible-forge-user': false})
    expect(value.extraKnownMarketplaces).toEqual({})
  })

  it('re-adds an owned key the user deleted, like a deleted tracked file', () => {
    const installed = merge({text: '{}', desired: [forgeValues[1]]})
    const result = merge({text: '{"enabledPlugins": {}}', owned: installed.owned, desired: [forgeValues[1]]})
    expect(JSON.parse(result.content!)).toEqual({enabledPlugins: {'foo@crucible-forge-user': true}})
  })
})

const catalog = `{
  "name": "acme",
  "plugins": [
    {"name": "user-a", "source": "./a"},
    {"name": "user-b", "source": "./b"},
    {"name": "user-c", "source": "./c"}
  ]
}`
const plugin = (name: string, version = '1.0.0'): KeyedValue => ({
  key: entry(['plugins'], 'name', name),
  value: {name, version, source: `./${name}`},
})
const names = (text: string) => (parse(text) as {plugins: {name: string}[]}).plugins.map((item) => item.name)

describe('BR-11 arrays merge by identity, not index (0003-AC-12)', () => {
  it('keeps user entries before, between and after forge entries across re-runs', () => {
    const first = merge({text: catalog, desired: [plugin('forge-x'), plugin('forge-y')]})
    expect(names(first.content!)).toEqual(['user-a', 'user-b', 'user-c', 'forge-x', 'forge-y'])
    // A user moves entries around forge's; identity keeps both sides in place.
    const moved = JSON.stringify(
      {
        name: 'acme',
        plugins: ['user-a', 'forge-x', 'user-b', 'forge-y', 'user-c'].map((name) =>
          (parse(first.content!) as {plugins: {name: string}[]}).plugins.find((p) => p.name === name)!,
        ),
      },
      null,
      2,
    )
    const rerun = merge({text: moved, owned: first.owned, desired: [plugin('forge-x'), plugin('forge-y')]})
    expect(rerun.content).toBeNull()
    const updated = merge({
      text: moved,
      owned: first.owned,
      desired: [plugin('forge-x', '2.0.0'), plugin('forge-y'), plugin('forge-z')],
    })
    expect(names(updated.content!)).toEqual(['user-a', 'forge-x', 'user-b', 'forge-y', 'user-c', 'forge-z'])
    expect((parse(updated.content!) as {plugins: {version?: string}[]}).plugins[1].version).toBe('2.0.0')
    const removed = merge({text: updated.content, owned: updated.owned, desired: [plugin('forge-y')]})
    expect(names(removed.content!)).toEqual(['user-a', 'user-b', 'forge-y', 'user-c'])
  })

  it('replaces a forge entry whole: a user field added to it is drift, and --force drops it', () => {
    const first = merge({text: catalog, desired: [plugin('forge-x')]})
    const edited = first.content!.replace('"name": "forge-x"', '"name": "forge-x", "note": "mine"')
    const input = {text: edited, owned: first.owned, desired: [plugin('forge-x', '2.0.0')]}
    expect(errorKind(() => merge(input))).toBe(KEYED_MERGE_ERRORS.DRIFT)
    const forced = merge({...input, drift: DRIFT_POLICIES.OVERWRITE})
    expect((parse(forced.content!) as {plugins: object[]}).plugins[3]).toEqual(
      plugin('forge-x', '2.0.0').value as object,
    )
  })

  it('merges arrays of strings by value', () => {
    const allow = (value: string): KeyedValue => ({key: entry(['permissions', 'allow'], null, value), value})
    const text = '{"permissions": {"allow": ["Read", "Bash(ls)"]}}'
    const first = merge({text, desired: [allow('Bash(forge:*)')]})
    const userEdit = first.content!.replace('"Bash(forge:*)"', '"Bash(forge:*)", "Write"')
    const rerun = merge({text: userEdit, owned: first.owned, desired: [allow('Bash(forge:*)')]})
    expect(rerun.content).toBeNull()
    const removed = merge({text: userEdit, owned: first.owned, desired: []})
    expect((parse(removed.content!) as {permissions: {allow: string[]}}).permissions.allow).toEqual([
      'Read',
      'Bash(ls)',
      'Write',
    ])
    expect(
      errorKind(() =>
        merge({text: '{"permissions": {"allow": ["Bash(forge:*)"]}}', desired: [allow('Bash(forge:*)')]}),
      ),
    ).toBe(KEYED_MERGE_ERRORS.DRIFT)
  })

  it('creates a missing owned array', () => {
    expect(names(merge({text: '{"name": "acme"}', desired: [plugin('forge-x')]}).content!)).toEqual(['forge-x'])
  })

  it.each([
    ['duplicate identity', '{"plugins": [{"name": "a"}, {"name": "a"}]}', KEYED_MERGE_ERRORS.DUPLICATE_IDENTITY],
    ['keyless entry', '{"plugins": [{"name": "a"}, {"source": "./b"}]}', KEYED_MERGE_ERRORS.MISSING_IDENTITY],
    ['non-string identity', '{"plugins": [{"name": 1}]}', KEYED_MERGE_ERRORS.MISSING_IDENTITY],
    ['non-array owned path', '{"plugins": {"name": "a"}}', KEYED_MERGE_ERRORS.INVALID_KEY],
  ])('fails with a named error on a %s in an owned array', (_name, text, kind) => {
    expect(errorKind(() => merge({text, desired: [plugin('forge-x')]}))).toBe(kind)
  })

  it('rejects forge declaring one identity twice or a value without its identity', () => {
    expect(errorKind(() => merge({text: '{}', desired: [plugin('x'), plugin('x', '2.0.0')]}))).toBe(
      KEYED_MERGE_ERRORS.DUPLICATE_IDENTITY,
    )
    const wrong = {key: entry(['plugins'], 'name', 'x'), value: {name: 'y'}}
    expect(errorKind(() => merge({text: '{}', desired: [wrong]}))).toBe(KEYED_MERGE_ERRORS.MISSING_IDENTITY)
  })
})

describe('BR-11 owned key paths (0003-AC-12)', () => {
  it.each<[OwnedKey, string]>([
    [member('enabledPlugins', 'foo@crucible-forge-user'), 'enabledPlugins["foo@crucible-forge-user"]'],
    [entry(['plugins'], 'name', 'foo'), 'plugins[name=foo]'],
    [entry(['permissions', 'allow'], null, 'Bash(ls)'), 'permissions.allow[="Bash(ls)"]'],
    [member('a.b', 'c'), '["a.b"].c'],
    [entry(['x'], 'id', 'with ] and "quotes"'), 'x[id="with ] and \\"quotes\\""]'],
  ])('round-trips %j as %s', (key, text) => {
    expect(formatOwnedKey(key)).toBe(text)
    expect(parseOwnedKey(text)).toEqual(key)
    expect(isOwnedKey(text)).toBe(true)
  })
  it.each(['', 'a..b', 'a[', 'a[name=x]b', '[name=x]', 'a[na me=x]', 'a[=]', 'a["unterminated]', '.a'])(
    'rejects malformed key %p',
    (text) => {
      expect(isOwnedKey(text)).toBe(false)
    },
  )
  it('rejects overlapping owned keys', () => {
    const owned = {[formatOwnedKey(member('enabledPlugins'))]: hashOwnedValue({})}
    expect(errorKind(() => merge({text: '{}', owned, desired: [forgeValues[1]]}))).toBe(KEYED_MERGE_ERRORS.INVALID_KEY)
  })
})
