import {mkdir, readFile} from 'node:fs/promises'
import {join} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {describe, expect, it} from 'bun:test'

import {hashContent} from '@domain/sync/state'

import {getSyncStatePath, loadSyncState, parseSyncState, writeSyncState} from './state'

const getDir = useTmpDir('sync_state')
const legacyPath = '.claude/rules/a.md'
const legacy = {lastSync: '', files: {[legacyPath]: {hash: hashContent('desired'), sourceName: 'old'}}}
it.each([false, true].flatMap((current) => [false, true].map((malformed) => ({current, malformed}))))(
  'AC-6 rejects raw own __proto__ state keys before record parsing, current=$current malformed=$malformed',
  ({current, malformed}) => {
    const entry = {
      hash: hashContent('retained'),
      sourceName: 'unknown-owner',
      ...(current ? {baseline: 'installed'} : {}),
    }
    const input = JSON.parse(
      `{"lastSync":"","files":{"__proto__":${malformed ? 'null' : JSON.stringify(entry)}}${current ? ',"version":2' : ''}}`,
    )
    const before = JSON.stringify(input)
    expect(Object.hasOwn(input.files, '__proto__')).toBe(true)
    expect(() => parseSyncState(input)).toThrow('Unsupported tracked state path: __proto__')
    expect(JSON.stringify(input)).toBe(before)
    expect(Object.getPrototypeOf(input.files)).toBe(Object.prototype)
  },
)
it.each(['constructor', 'prototype'])('AC-6 keeps ordinary unknown-owner state keys: %s', (path) => {
  const entry = {hash: hashContent('retained'), sourceName: 'unknown-owner', baseline: 'installed' as const}
  const input = JSON.parse(`{"version":2,"lastSync":"","files":{${JSON.stringify(path)}:${JSON.stringify(entry)}}}`)
  expect(Object.keys(parseSyncState(input).files)).toEqual([path])
  expect(parseSyncState(input).files[path]).toEqual(entry)
})
it('AC-6 parses legacy state without mutating its input', () => {
  expect(parseSyncState(legacy).files[legacyPath].baseline).toBe('legacy-unknown')
  expect(legacy.files[legacyPath]).not.toHaveProperty('baseline')
})
it.each([
  null,
  {},
  {...legacy, version: 1},
  {...legacy, version: 3},
  {...legacy, files: {[legacyPath]: {hash: 'not-a-hash', sourceName: 'x'}}},
  {...legacy, files: {'../escape': legacy.files[legacyPath]}},
  {...legacy, version: 2},
])('AC-6 rejects malformed or unsupported state %#', (input) => {
  expect(() => parseSyncState(input)).toThrow()
})
it('AC-6 canonicalizes legacy/native separators without merging distinct tracked entries', () => {
  const entry = {hash: hashContent('original'), sourceName: 'team'}
  const original = {lastSync: '', files: {'.claude\\rules\\a.md': entry}}
  const state = parseSyncState(original)
  expect(state.files['.claude/rules/a.md']).toEqual({...entry, baseline: 'legacy-unknown'})
  expect(Object.keys(original.files)).toEqual(['.claude\\rules\\a.md'])
  expect(() => parseSyncState({...original, files: {...original.files, '.claude/rules/a.md': entry}})).toThrow(
    'Competing',
  )
  expect(
    Object.keys(parseSyncState({...original, files: {...original.files, '.claude/rules/A.md': entry}}).files),
  ).toHaveLength(2)
})
it.each(
  [false, true].flatMap((current) =>
    ['.claude/rules/a\\b.md', '.ClAuDe/rules/a\\b.md', '.claude\\rules/a.md'].map((path) => ({current, path})),
  ),
)(
  'AC-5/6 mixed separators cannot reinterpret native POSIX ownership, current=$current path=$path',
  ({current, path}) => {
    const entry = {hash: hashContent('original'), sourceName: 'team', ...(current ? {baseline: 'installed'} : {})}
    const input = {...(current ? {version: 2} : {}), lastSync: '', files: {[path]: entry}}
    const before = JSON.stringify(input)
    if (process.platform === 'win32') expect(parseSyncState(input).files[path.replaceAll('\\', '/')]).toBeDefined()
    else expect(() => parseSyncState(input)).toThrow('Ambiguous tracked backslash path')
    expect(JSON.stringify(input)).toBe(before)
  },
)
it('AC-4/6 unmatched mixed paths remain outside all assistant destinations after normalization', () => {
  const path = 'unknown/.claude\\rules/a.md',
    entry = {hash: hashContent('retained'), sourceName: 'unknown'}
  const input = {lastSync: '', files: {[path]: entry}}
  expect(parseSyncState(input).files['unknown/.claude/rules/a.md']).toEqual({...entry, baseline: 'legacy-unknown'})
  expect(Object.keys(input.files)).toEqual([path])
})

describe('getSyncStatePath', () => {
  it('returns path inside .crucible dir', () => {
    expect(getSyncStatePath('/my/project')).toBe('/my/project/.crucible/sync-state.json')
  })
})

describe('loadSyncState', () => {
  it('returns empty state when file does not exist', async () => {
    const state = await loadSyncState(getDir())
    expect(state.lastSync).toBe('')
    expect(Object.keys(state.files)).toHaveLength(0)
  })

  it('parses state from existing file', async () => {
    const dir = getDir()
    const stateDir = join(dir, '.crucible')
    await mkdir(stateDir, {recursive: true})

    const state = {
      lastSync: '2026-05-21T12:00:00.000Z',
      files: {
        '.claude/skills/deploy.md': {hash: hashContent('old'), sourceName: 'team'},
      },
    }
    await Bun.write(join(stateDir, 'sync-state.json'), JSON.stringify(state))

    const loaded = await loadSyncState(dir)
    expect(loaded.lastSync).toBe('2026-05-21T12:00:00.000Z')
    expect(loaded.files['.claude/skills/deploy.md'].hash).toBe(hashContent('old'))
    expect(loaded.files['.claude/skills/deploy.md'].baseline).toBe('legacy-unknown')
    expect(loaded.files['.claude/skills/deploy.md'].sourceName).toBe('team')
  })
})

describe('writeSyncState', () => {
  it('creates .crucible dir and writes state file', async () => {
    const dir = getDir()
    const state = {
      lastSync: '2026-05-21T12:00:00.000Z',
      files: {
        'a.md': {hash: 'abc', sourceName: 'src'},
      },
    }

    await writeSyncState(dir, state)

    const raw = await readFile(join(dir, '.crucible', 'sync-state.json'), 'utf-8')
    const parsed = JSON.parse(raw)
    expect(parsed.lastSync).toBe('2026-05-21T12:00:00.000Z')
    expect(parsed.files['a.md'].hash).toBe('abc')
  })

  it('overwrites existing state file', async () => {
    const dir = getDir()

    await writeSyncState(dir, {lastSync: 'old', files: {old: {hash: 'x', sourceName: 's'}}})
    await writeSyncState(dir, {lastSync: 'new', files: {new: {hash: 'y', sourceName: 's'}}})

    const raw = await readFile(join(dir, '.crucible', 'sync-state.json'), 'utf-8')
    const parsed = JSON.parse(raw)
    expect(parsed.lastSync).toBe('new')
    expect(parsed.files).not.toHaveProperty('old')
    expect(parsed.files['new'].hash).toBe('y')
  })
})
