import {expect, it} from 'bun:test'

import {reconcileState} from './reconcile'
import {hashContent} from './state'
import type {SyncFileSummary} from './types'

it('AC-6 reconciles installed, retained unknown, skipped new and deleted entries without mutating the baseline', () => {
  const target = {
    targetPath: '.claude/rules/current.md',
    sourcePath: 'rules/current.md',
    assistantId: 'claude-code',
    sourceName: 'team',
    content: 'actually installed',
  }
  const previous = {
    lastSync: 'old',
    files: {
      'disabled.md': {hash: hashContent('disabled'), sourceName: 'removed'},
      'stale.md': {hash: hashContent('stale'), sourceName: 'removed'},
    },
  }
  const before = structuredClone(previous)
  const summary = (path: string, status: SyncFileSummary['status']): SyncFileSummary => ({
    targetPath: path,
    sourcePath: '',
    assistantId: target.assistantId,
    status,
  })
  for (const status of ['new', 'update', 'no_change'] as const) {
    const state = reconcileState(
      previous,
      [target],
      [summary(target.targetPath, status), summary('never-installed.md', 'skipped'), summary('stale.md', 'deleted')],
      'new timestamp',
    )
    expect(state).toEqual({
      version: 2,
      lastSync: 'new timestamp',
      files: {
        'disabled.md': {...previous.files['disabled.md'], baseline: 'legacy-unknown'},
        [target.targetPath]: {hash: hashContent(target.content), sourceName: 'team', baseline: 'installed'},
      },
    })
  }
  expect(previous).toEqual(before)
  expect(() => reconcileState(previous, [], [summary(target.targetPath, 'update')], 'now')).toThrow(
    'Missing reconciled target',
  )
})
