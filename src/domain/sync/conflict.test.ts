import {describe, expect, it} from 'bun:test'

import {detectLocalConflict} from './conflict'
import type {SyncState} from './state'
import {hashContent} from './state'

function stateWith(files: Record<string, string>): SyncState {
  const entries: SyncState['files'] = {}
  for (const [path, content] of Object.entries(files)) {
    entries[path] = {hash: hashContent(content), sourceName: 'test', baseline: 'installed'}
  }
  return {lastSync: '2026-01-01T00:00:00.000Z', files: entries}
}

describe('detectLocalConflict', () => {
  it('returns null when file is not in sync state (new file)', () => {
    const state = stateWith({})
    expect(detectLocalConflict('a.md', 'local', 'remote', state)).toBeNull()
  })

  it('returns null when local content matches stored hash (no local edit)', () => {
    const original = 'original content'
    const state = stateWith({'a.md': original})
    expect(detectLocalConflict('a.md', original, 'new remote', state)).toBeNull()
  })

  it('returns null when remote matches stored hash (source unchanged)', () => {
    const original = 'original content'
    const state = stateWith({'a.md': original})
    expect(detectLocalConflict('a.md', 'user edited', original, state)).toBeNull()
  })

  it('detects conflict when both local and remote differ from stored', () => {
    const original = 'original content'
    const state = stateWith({'a.md': original})
    const result = detectLocalConflict('a.md', 'user edited', 'remote updated', state)

    expect(result).not.toBeNull()
    expect(result!.targetPath).toBe('a.md')
    expect(result!.storedHash).toBe(hashContent(original))
    expect(result!.localHash).toBe(hashContent('user edited'))
    expect(result!.remoteHash).toBe(hashContent('remote updated'))
  })

  it('returns null when all three are the same (no change at all)', () => {
    const same = 'same content'
    const state = stateWith({'a.md': same})
    expect(detectLocalConflict('a.md', same, same, state)).toBeNull()
  })
})
