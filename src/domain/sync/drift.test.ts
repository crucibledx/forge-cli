import {describe, expect, it} from 'bun:test'

import {detectDrift, DRIFT_STATUSES} from './drift'
import type {SyncState} from './state'
import {hashContent} from './state'

function stateWith(files: Record<string, {content: string; sourceName: string}>): SyncState {
  const entries: SyncState['files'] = {}
  for (const [path, {content, sourceName}] of Object.entries(files)) {
    entries[path] = {hash: hashContent(content), sourceName}
  }
  return {lastSync: '2026-01-01T00:00:00.000Z', files: entries}
}

describe('detectDrift', () => {
  it('reports in_sync when disk matches stored hash', () => {
    const state = stateWith({
      'a.md': {content: 'hello', sourceName: 'team'},
    })
    const result = detectDrift(state, {'a.md': 'hello'})

    expect(result.files).toHaveLength(1)
    expect(result.files[0].status).toBe(DRIFT_STATUSES.IN_SYNC)
    expect(result.files[0].targetPath).toBe('a.md')
    expect(result.files[0].sourceName).toBe('team')
  })

  it('reports modified when disk content differs from stored hash', () => {
    const state = stateWith({
      'a.md': {content: 'original', sourceName: 'team'},
    })
    const result = detectDrift(state, {'a.md': 'user edited'})

    expect(result.files).toHaveLength(1)
    expect(result.files[0].status).toBe(DRIFT_STATUSES.MODIFIED)
  })

  it('reports deleted when file is missing from disk', () => {
    const state = stateWith({
      'a.md': {content: 'original', sourceName: 'team'},
    })
    const result = detectDrift(state, {'a.md': null})

    expect(result.files).toHaveLength(1)
    expect(result.files[0].status).toBe(DRIFT_STATUSES.DELETED)
  })

  it('reports deleted when file is not in diskContents at all', () => {
    const state = stateWith({
      'a.md': {content: 'original', sourceName: 'team'},
    })
    const result = detectDrift(state, {})

    expect(result.files).toHaveLength(1)
    expect(result.files[0].status).toBe(DRIFT_STATUSES.DELETED)
  })

  it('handles mixed statuses across multiple files', () => {
    const state = stateWith({
      'a.md': {content: 'same', sourceName: 'team'},
      'b.md': {content: 'original', sourceName: 'team'},
      'c.md': {content: 'gone', sourceName: 'ops'},
    })
    const result = detectDrift(state, {
      'a.md': 'same',
      'b.md': 'changed',
      'c.md': null,
    })

    expect(result.files).toHaveLength(3)

    const byPath = Object.fromEntries(result.files.map((f) => [f.targetPath, f]))
    expect(byPath['a.md'].status).toBe(DRIFT_STATUSES.IN_SYNC)
    expect(byPath['b.md'].status).toBe(DRIFT_STATUSES.MODIFIED)
    expect(byPath['c.md'].status).toBe(DRIFT_STATUSES.DELETED)
  })

  it('returns empty files array when sync state has no files', () => {
    const state: SyncState = {lastSync: '2026-01-01T00:00:00.000Z', files: {}}
    const result = detectDrift(state, {})

    expect(result.files).toHaveLength(0)
    expect(result.lastSync).toBe('2026-01-01T00:00:00.000Z')
  })

  it('preserves lastSync from sync state', () => {
    const state = stateWith({'a.md': {content: 'x', sourceName: 's'}})
    const result = detectDrift(state, {'a.md': 'x'})

    expect(result.lastSync).toBe('2026-01-01T00:00:00.000Z')
  })
})
