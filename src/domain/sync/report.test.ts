import {describe, expect, it} from 'bun:test'

import {DRIFT_STATUSES} from './drift'
import {buildSyncReport} from './report'

describe('buildSyncReport', () => {
  it('builds a report with correct structure', () => {
    const report = buildSyncReport({
      startTime: Date.now() - 500,
      sources: ['team', 'shared'],
      assistants: ['claude-code', 'windsurf'],
      synced: 10,
      skipped: 2,
      conflicts: 0,
      errors: 1,
      driftDetails: [],
      success: true,
    })

    expect(report.timestamp).toBeDefined()
    expect(report.duration_ms).toBeGreaterThanOrEqual(0)
    expect(report.sources).toEqual(['team', 'shared'])
    expect(report.assistants).toEqual(['claude-code', 'windsurf'])
    expect(report.files.synced).toBe(10)
    expect(report.files.skipped).toBe(2)
    expect(report.files.conflicts).toBe(0)
    expect(report.files.errors).toBe(1)
    expect(report.drift.detected).toBe(false)
    expect(report.drift.files_drifted).toBe(0)
    expect(report.success).toBe(true)
  })

  it('detects drift from details', () => {
    const report = buildSyncReport({
      startTime: Date.now(),
      sources: ['team'],
      assistants: ['claude-code'],
      synced: 5,
      skipped: 0,
      conflicts: 0,
      errors: 0,
      driftDetails: [
        {targetPath: '.claude/a.md', sourceName: 'team', status: DRIFT_STATUSES.MODIFIED},
        {targetPath: '.claude/b.md', sourceName: 'team', status: DRIFT_STATUSES.IN_SYNC},
        {targetPath: '.claude/c.md', sourceName: 'team', status: DRIFT_STATUSES.DELETED},
      ],
      success: true,
    })

    expect(report.drift.detected).toBe(true)
    expect(report.drift.files_drifted).toBe(2)
    expect(report.drift.details).toHaveLength(3)
  })

  it('includes error message when failed', () => {
    const report = buildSyncReport({
      startTime: Date.now(),
      sources: ['team'],
      assistants: ['claude-code'],
      synced: 0,
      skipped: 0,
      conflicts: 0,
      errors: 0,
      driftDetails: [],
      success: false,
      error: 'Source unreachable',
    })

    expect(report.success).toBe(false)
    expect(report.error).toBe('Source unreachable')
  })
})
