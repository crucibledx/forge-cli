import {describe, expect, it} from 'bun:test'

import {detectLocalConflict} from './conflict'
import {detectDrift, detectFullDrift} from './drift'
import {reconcileState} from './reconcile'
import {hashContent} from './state'

const path = '.claude/rules/a.md'
const state = {
  lastSync: '2026-01-01T00:00:00.000Z',
  files: {[path]: {hash: hashContent('desired'), sourceName: 'old', baseline: 'legacy-unknown' as const}},
}
const target = {
  targetPath: path,
  content: 'desired',
  sourcePath: 'rules/a.md',
  sourceName: 'new',
  assistantId: 'claude-code',
}
const summary = (status: 'skipped' | 'no_change' | 'deleted') => ({
  targetPath: path,
  sourcePath: '',
  assistantId: 'claude-code',
  status,
})

describe('BR-04 state upgrade (AC-6)', () => {
  it('does not trust legacy desired hashes', () => {
    expect(state.files[path].baseline).toBe('legacy-unknown')
    expect(detectLocalConflict(path, 'local edit', 'desired', state)).not.toBeNull()
    expect(detectLocalConflict(path, 'desired', 'desired', state)).toBeNull()
    expect(detectDrift(state, {[path]: 'desired'}).files[0].status).toBe('legacy_unknown')
    expect(detectFullDrift(state, {[path]: 'desired'}, {[path]: 'desired'}).files[0].status).toBe('legacy_unknown')
  })
  it('retains unknown/skipped and retained stale entries, installs only committed/equal desired bytes', () => {
    const skipped = reconcileState(state, [target], [summary('skipped')], 'now')
    expect(skipped.files[path]).toEqual(state.files[path])
    expect(reconcileState(state, [], [], 'now').files[path]).toEqual(state.files[path])
    expect(reconcileState(state, [target], [summary('no_change')], 'now').files[path]).toEqual({
      hash: hashContent('desired'),
      sourceName: 'new',
      baseline: 'installed',
    })
    expect(reconcileState({files: {}, lastSync: ''}, [target], [summary('skipped')], 'now').files).toEqual({})
    expect(reconcileState(state, [], [summary('deleted')], 'now').files).toEqual({})
  })
})
