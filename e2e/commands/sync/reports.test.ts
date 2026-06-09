/**
 * E2E tests for sync report generation.
 *
 * Verifies that `forge sync` writes a report to ~/.crucible/forge/reports/.
 */

import {existsSync, readdirSync} from 'node:fs'
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'

import {describe, expect, it} from 'bun:test'

import type {SyncReport} from '@domain/sync/report'
import {buildConfigYaml, writeConfig, writeSourceTree} from '@e2e/fixtures'
import {runSync, useTmpDir} from '@e2e/framework'

const getDir = useTmpDir('forge-sync-reports')

describe('sync reports', () => {
  it('writes latest.json after successful sync', async () => {
    const dir = getDir()
    const sourceDir = join(dir, 'source')
    await writeSourceTree(sourceDir, {skills: {'deploy.md': '# Deploy'}})
    await writeConfig(
      dir,
      buildConfigYaml({
        assistants: ['claude-code'],
        localSource: {path: sourceDir},
      }),
    )

    await runSync(dir)

    const latestPath = join(dir, '.crucible', 'forge', 'reports', 'latest.json')
    expect(existsSync(latestPath)).toBe(true)

    const report: SyncReport = JSON.parse(await readFile(latestPath, 'utf-8'))
    expect(report.success).toBe(true)
    expect(report.sources).toEqual(['test-source'])
    expect(report.assistants).toEqual(['claude-code'])
    expect(report.files.synced).toBeGreaterThan(0)
    expect(report.files.errors).toBe(0)
    expect(report.duration_ms).toBeGreaterThanOrEqual(0)
    expect(report.timestamp).toBeDefined()
  })

  it('writes to history directory after sync', async () => {
    const dir = getDir()
    const sourceDir = join(dir, 'source')
    await writeSourceTree(sourceDir, {skills: {'deploy.md': '# Deploy'}})
    await writeConfig(
      dir,
      buildConfigYaml({
        assistants: ['claude-code'],
        localSource: {path: sourceDir},
      }),
    )

    await runSync(dir)

    const historyDir = join(dir, '.crucible', 'forge', 'reports', 'history')
    expect(existsSync(historyDir)).toBe(true)

    const files = readdirSync(historyDir).filter((f) => f.endsWith('.json'))
    expect(files.length).toBeGreaterThanOrEqual(1)
  })

  it('tracks no_change on second sync', async () => {
    const dir = getDir()
    const sourceDir = join(dir, 'source')
    await writeSourceTree(sourceDir, {skills: {'deploy.md': '# Deploy'}})
    await writeConfig(
      dir,
      buildConfigYaml({
        assistants: ['claude-code'],
        localSource: {path: sourceDir},
      }),
    )

    await runSync(dir)
    await runSync(dir)

    const latestPath = join(dir, '.crucible', 'forge', 'reports', 'latest.json')
    const report: SyncReport = JSON.parse(await readFile(latestPath, 'utf-8'))
    expect(report.files.skipped).toBeGreaterThan(0)
    expect(report.files.synced).toBe(0)
  })

  it('does not write report on dry-run', async () => {
    const dir = getDir()
    const sourceDir = join(dir, 'source')
    await writeSourceTree(sourceDir, {skills: {'deploy.md': '# Deploy'}})
    await writeConfig(
      dir,
      buildConfigYaml({
        assistants: ['claude-code'],
        localSource: {path: sourceDir},
      }),
    )

    await runSync(dir, ['--dry-run'])

    const latestPath = join(dir, '.crucible', 'forge', 'reports', 'latest.json')
    expect(existsSync(latestPath)).toBe(false)
  })
})
