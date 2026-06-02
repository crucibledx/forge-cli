import {describe, expect, it} from 'bun:test'

import {detectDrift, detectFullDrift, DRIFT_STATUSES} from './drift'
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

describe('detectFullDrift', () => {
  it('reports in_sync when local and remote match stored', () => {
    const state = stateWith({'a.md': {content: 'hello', sourceName: 'team'}})
    const result = detectFullDrift(state, {'a.md': 'hello'}, {'a.md': 'hello'})

    expect(result.files[0].status).toBe(DRIFT_STATUSES.IN_SYNC)
  })

  it('reports remote_updated when only remote changed', () => {
    const state = stateWith({'a.md': {content: 'original', sourceName: 'team'}})
    const result = detectFullDrift(state, {'a.md': 'original'}, {'a.md': 'updated'})

    expect(result.files[0].status).toBe(DRIFT_STATUSES.REMOTE_UPDATED)
  })

  it('reports modified when only local changed', () => {
    const state = stateWith({'a.md': {content: 'original', sourceName: 'team'}})
    const result = detectFullDrift(state, {'a.md': 'edited'}, {'a.md': 'original'})

    expect(result.files[0].status).toBe(DRIFT_STATUSES.MODIFIED)
  })

  it('reports conflict when both local and remote changed', () => {
    const state = stateWith({'a.md': {content: 'original', sourceName: 'team'}})
    const result = detectFullDrift(state, {'a.md': 'local edit'}, {'a.md': 'remote edit'})

    expect(result.files[0].status).toBe(DRIFT_STATUSES.CONFLICT)
  })

  it('reports new_in_source for files not in sync state', () => {
    const state: SyncState = {lastSync: '2026-01-01T00:00:00.000Z', files: {}}
    const result = detectFullDrift(state, {}, {'new.md': 'content'})

    expect(result.files).toHaveLength(1)
    expect(result.files[0].status).toBe(DRIFT_STATUSES.NEW_IN_SOURCE)
    expect(result.files[0].targetPath).toBe('new.md')
  })

  it('reports removed_from_source for files in state but not remote', () => {
    const state = stateWith({'old.md': {content: 'x', sourceName: 'team'}})
    const result = detectFullDrift(state, {'old.md': 'x'}, {})

    expect(result.files).toHaveLength(1)
    expect(result.files[0].status).toBe(DRIFT_STATUSES.REMOVED_FROM_SOURCE)
  })

  it('reports deleted when file missing from disk', () => {
    const state = stateWith({'a.md': {content: 'x', sourceName: 'team'}})
    const result = detectFullDrift(state, {'a.md': null}, {'a.md': 'x'})

    expect(result.files[0].status).toBe(DRIFT_STATUSES.DELETED)
  })

  it('handles mixed statuses', () => {
    const state = stateWith({
      'same.md': {content: 'v1', sourceName: 'team'},
      'local.md': {content: 'v1', sourceName: 'team'},
      'remote.md': {content: 'v1', sourceName: 'team'},
      'both.md': {content: 'v1', sourceName: 'team'},
      'gone.md': {content: 'v1', sourceName: 'team'},
      'stale.md': {content: 'v1', sourceName: 'team'},
    })
    const disk: Record<string, string | null> = {
      'same.md': 'v1',
      'local.md': 'local-edit',
      'remote.md': 'v1',
      'both.md': 'local-edit',
      'gone.md': null,
      'stale.md': 'v1',
    }
    const remote: Record<string, string> = {
      'same.md': 'v1',
      'local.md': 'v1',
      'remote.md': 'remote-edit',
      'both.md': 'remote-edit',
      'gone.md': 'v1', // still in source — disk deletion is local
      'brand-new.md': 'new content',
      // stale.md intentionally absent — removed from source
    }
    const result = detectFullDrift(state, disk, remote)
    const byPath = Object.fromEntries(result.files.map((f) => [f.targetPath, f]))

    expect(byPath['same.md'].status).toBe(DRIFT_STATUSES.IN_SYNC)
    expect(byPath['local.md'].status).toBe(DRIFT_STATUSES.MODIFIED)
    expect(byPath['remote.md'].status).toBe(DRIFT_STATUSES.REMOTE_UPDATED)
    expect(byPath['both.md'].status).toBe(DRIFT_STATUSES.CONFLICT)
    expect(byPath['gone.md'].status).toBe(DRIFT_STATUSES.DELETED)
    expect(byPath['stale.md'].status).toBe(DRIFT_STATUSES.REMOVED_FROM_SOURCE)
    expect(byPath['brand-new.md'].status).toBe(DRIFT_STATUSES.NEW_IN_SOURCE)
  })
})
