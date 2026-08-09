import {mkdir, rm, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {describe, expect, it} from 'bun:test'

import type {SyncState} from '@domain/sync/state'

import {countFilesForSource, deleteSourceFiles, getFilesForSource, removeSourceFromState} from './source.cleanup'

const state: SyncState = {
  lastSync: '2026-06-10T08:00:00.000Z',
  files: {
    '.claude/rules/deploy.md': {hash: 'abc', sourceName: 'team'},
    '.claude/rules/test.md': {hash: 'def', sourceName: 'team'},
    '.claude/rules/lint.md': {hash: 'ghi', sourceName: 'org'},
  },
}

describe('getFilesForSource', () => {
  it('returns files matching source name', () => {
    expect(getFilesForSource(state, 'team')).toEqual(['.claude/rules/deploy.md', '.claude/rules/test.md'])
  })

  it('returns empty for unknown source', () => {
    expect(getFilesForSource(state, 'unknown')).toEqual([])
  })
})

describe('countFilesForSource', () => {
  it('counts files for a source', () => {
    expect(countFilesForSource(state, 'team')).toBe(2)
    expect(countFilesForSource(state, 'org')).toBe(1)
    expect(countFilesForSource(state, 'unknown')).toBe(0)
  })
})

describe('removeSourceFromState', () => {
  it('removes all entries for a source', () => {
    const result = removeSourceFromState(state, 'team')
    expect(Object.keys(result.files)).toEqual(['.claude/rules/lint.md'])
    expect(result.lastSync).toBe(state.lastSync)
  })

  it('does not mutate original state', () => {
    removeSourceFromState(state, 'team')
    expect(Object.keys(state.files).length).toBe(3)
  })
})

describe('deleteSourceFiles', () => {
  it('deletes existing files and counts them', async () => {
    const tmpDir = join(import.meta.dir, `__test-cleanup-${Date.now()}__`)
    try {
      await mkdir(join(tmpDir, '.claude', 'rules'), {recursive: true})
      await writeFile(join(tmpDir, '.claude', 'rules', 'a.md'), 'content')
      await writeFile(join(tmpDir, '.claude', 'rules', 'b.md'), 'content')

      const result = await deleteSourceFiles(tmpDir, ['.claude/rules/a.md', '.claude/rules/b.md'])

      expect(result.cleaned).toBe(2)
      expect(result.errors).toBe(0)
      expect(await Bun.file(join(tmpDir, '.claude', 'rules', 'a.md')).exists()).toBe(false)
      expect(await Bun.file(join(tmpDir, '.claude', 'rules', 'b.md')).exists()).toBe(false)
    } finally {
      await rm(tmpDir, {recursive: true, force: true})
    }
  })

  it('counts already-missing files as cleaned', async () => {
    const tmpDir = join(import.meta.dir, `__test-cleanup-missing-${Date.now()}__`)
    try {
      await mkdir(tmpDir, {recursive: true})

      const result = await deleteSourceFiles(tmpDir, ['nonexistent.md'])

      expect(result.cleaned).toBe(1)
      expect(result.errors).toBe(0)
    } finally {
      await rm(tmpDir, {recursive: true, force: true})
    }
  })
})
