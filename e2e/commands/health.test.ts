/**
 * E2E tests for `forge health`.
 *
 * Covers: no config, never synced, after sync (report written), output structure.
 */

import {join} from 'node:path'

import {describe, expect, it} from 'bun:test'

import {buildConfigYaml, writeConfig, writeSourceTree} from '@e2e/fixtures'
import {runHealth, runSync, useTmpDir} from '@e2e/framework'

const getDir = useTmpDir('forge-health')

describe('forge health', () => {
  it('exits with error when no config exists', async () => {
    const dir = getDir()
    const result = await runHealth(dir)
    expect(result.exitCode).toBe(1)
    expect(result.output).toContain('No project config found')
  })

  it('shows "never" when no sync has run', async () => {
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

    const result = await runHealth(dir)
    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('Forge Health Report')
    expect(result.output).toContain('Last sync:        never')
    expect(result.output).toContain('Reports:')
    expect(result.output).toContain('0 entries')
  })

  it('shows last sync info after a sync', async () => {
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
    const result = await runHealth(dir)

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('Forge Health Report')
    expect(result.output).toContain('just now')
    expect(result.output).toContain('success')
    expect(result.output).toContain('claude-code')
    expect(result.output).toContain('1 configured')
  })

  it('shows schedule info when configured', async () => {
    const dir = getDir()
    const sourceDir = join(dir, 'source')
    await writeSourceTree(sourceDir, {skills: {'deploy.md': '# Deploy'}})
    await writeConfig(
      dir,
      buildConfigYaml({
        assistants: ['claude-code'],
        localSource: {path: sourceDir},
        sync: {schedule: '0 9 * * 1'},
      }),
    )

    const result = await runHealth(dir)
    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('Sync frequency:')
    expect(result.output).toContain('Monday')
  })

  it('shows manual sync frequency when no schedule', async () => {
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

    const result = await runHealth(dir)
    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('manual')
  })
})
