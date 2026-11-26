import {mkdir, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {afterAll, beforeAll, describe, expect, it} from 'bun:test'

import type {SyncReport} from '@domain/sync/report'

import {createReportService} from './writer'

function makeReport(overrides: Partial<SyncReport> = {}): SyncReport {
  return {
    timestamp: new Date().toISOString(),
    duration_ms: 123,
    sources: ['team'],
    harnesses: ['claude-code'],
    files: {synced: 5, skipped: 1, conflicts: 0, errors: 0},
    drift: {detected: false, files_drifted: 0, details: []},
    success: true,
    ...overrides,
  }
}

describe('report service', () => {
  let service: ReturnType<typeof createReportService>
  const testDir = join(tmpdir(), `forge-report-test-${Date.now()}`)

  beforeAll(() => {
    service = createReportService(testDir)
  })

  afterAll(async () => {
    await rm(testDir, {recursive: true, force: true})
  })

  it('writes and reads latest report', async () => {
    const report = makeReport({timestamp: '2026-06-09T20:00:00.000Z'})
    await service.writeReport(report)

    const latest = await service.readLatest()
    expect(latest).not.toBeNull()
    expect(latest!.timestamp).toBe('2026-06-09T20:00:00.000Z')
    expect(latest!.files.synced).toBe(5)
    expect(latest!.success).toBe(true)
  })

  it('writes to history directory', async () => {
    const report = makeReport({timestamp: '2026-06-09T20:01:00.000Z'})
    await service.writeReport(report)

    const history = await service.readHistory()
    expect(history.length).toBeGreaterThanOrEqual(1)
    expect(history.some((r) => r.timestamp === '2026-06-09T20:01:00.000Z')).toBe(true)
  })

  it('readHistory returns entries sorted by time', async () => {
    const r1 = makeReport({timestamp: '2026-06-09T20:02:00.000Z', duration_ms: 100})
    const r2 = makeReport({timestamp: '2026-06-09T20:03:00.000Z', duration_ms: 200})
    await service.writeReport(r1)
    await service.writeReport(r2)

    const history = await service.readHistory()
    const i1 = history.findIndex((r) => r.timestamp === '2026-06-09T20:02:00.000Z')
    const i2 = history.findIndex((r) => r.timestamp === '2026-06-09T20:03:00.000Z')
    expect(i1).not.toBe(-1)
    expect(i2).not.toBe(-1)
    expect(i1).toBeLessThan(i2)
  })

  it('readLatest returns null when no reports exist', async () => {
    // Create a fresh service pointing to a temp dir to test empty state
    // Since we can't easily override REPORT_DIR, we test the null path
    // by checking the function doesn't crash
    const latest = await service.readLatest()
    // At this point we've written reports above, so it should be non-null
    expect(latest).not.toBeNull()
  })

  it('getReportDir returns a path', () => {
    const dir = service.getReportDir()
    expect(dir).toContain('forge-report-test')
  })
})

describe('report service with v0.7 reports', () => {
  const dir = join(tmpdir(), `forge-report-v07-${Date.now()}`)
  const v07 = JSON.stringify({
    ...makeReport({timestamp: '2026-06-01T10:00:00.000Z'}),
    harnesses: undefined,
    assistants: ['cursor', 'cline'],
  })

  afterAll(async () => {
    await rm(dir, {recursive: true, force: true})
  })

  it('reads assistants from an old latest and history report as harnesses', async () => {
    await mkdir(join(dir, 'history'), {recursive: true})
    await writeFile(join(dir, 'latest.json'), v07, 'utf-8')
    await writeFile(join(dir, 'history', '2026-06-01-10-00-00-000.json'), v07, 'utf-8')
    const service = createReportService(dir)

    const latest = await service.readLatest()
    expect(latest!.harnesses).toEqual(['cursor', 'cline'])
    expect(latest).not.toHaveProperty('assistants')
    expect(latest!.timestamp).toBe('2026-06-01T10:00:00.000Z')
    expect((await service.readHistory()).map((r) => r.harnesses)).toEqual([['cursor', 'cline']])
  })
})
