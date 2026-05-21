import {createHash} from 'node:crypto'

import {describe, expect, it} from 'bun:test'

import {buildSyncState, emptySyncState, hashContent} from './state'

describe('hashContent', () => {
  it('returns SHA-256 hex digest', () => {
    const expected = createHash('sha256').update('hello', 'utf-8').digest('hex')
    expect(hashContent('hello')).toBe(expected)
  })

  it('returns different hashes for different content', () => {
    expect(hashContent('a')).not.toBe(hashContent('b'))
  })

  it('returns same hash for same content', () => {
    expect(hashContent('same')).toBe(hashContent('same'))
  })
})

describe('buildSyncState', () => {
  it('builds state from file list', () => {
    const state = buildSyncState([
      {targetPath: '.claude/skills/deploy.md', content: '# Deploy', sourceName: 'team'},
      {targetPath: '.cursor/rules/api.mdc', content: '---\nglobs: []\n---', sourceName: 'team'},
    ])

    expect(state.lastSync).toBeTruthy()
    expect(Object.keys(state.files)).toHaveLength(2)
    expect(state.files['.claude/skills/deploy.md'].hash).toBe(hashContent('# Deploy'))
    expect(state.files['.claude/skills/deploy.md'].sourceName).toBe('team')
  })

  it('returns empty files for empty input', () => {
    const state = buildSyncState([])
    expect(Object.keys(state.files)).toHaveLength(0)
    expect(state.lastSync).toBeTruthy()
  })

  it('last entry wins when duplicate paths', () => {
    const state = buildSyncState([
      {targetPath: 'a.md', content: 'first', sourceName: 'src1'},
      {targetPath: 'a.md', content: 'second', sourceName: 'src2'},
    ])

    expect(state.files['a.md'].hash).toBe(hashContent('second'))
    expect(state.files['a.md'].sourceName).toBe('src2')
  })
})

describe('emptySyncState', () => {
  it('returns state with no files and empty lastSync', () => {
    const state = emptySyncState()
    expect(state.lastSync).toBe('')
    expect(Object.keys(state.files)).toHaveLength(0)
  })
})
