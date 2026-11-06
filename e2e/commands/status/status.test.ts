/**
 * E2E tests for `forge status`.
 *
 * Covers: never synced, all in sync, locally modified, locally deleted, mixed drift.
 */

import {unlink, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {describe, expect, it} from 'bun:test'

import {loadProjectConfig} from '@infrastructure/config/loader'
import {writeProjectConfig} from '@infrastructure/config/writer'
import {buildConfigYaml, writeConfig, writeSourceTree} from '@e2e/fixtures'
import {runStatus, runSync, useTmpDir} from '@e2e/framework'

const getDir = useTmpDir('forge-status')

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function setupSynced(dir: string): Promise<string> {
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
  return sourceDir
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('forge status', () => {
  it('AC-4,6 disabled assistants retain real upstream status instead of false source removal', async () => {
    const dir = getDir(),
      source = join(dir, 'source')
    await writeSourceTree(source, {rules: {'a.md': '# Rule'}})
    await writeConfig(dir, buildConfigYaml({assistants: ['claude-code', 'cursor'], localSource: {path: source}}))
    expect((await runSync(dir)).exitCode).toBe(0)
    const config = (await loadProjectConfig(dir))!
    config.assistants.find((a) => a.id === 'cursor')!.enabled = false
    await writeProjectConfig(dir, config)
    expect((await runSync(dir)).exitCode).toBe(0)
    const status = await runStatus(dir)
    expect(status.exitCode).toBe(0)
    expect(status.output).toContain('in sync')
    expect(status.output).not.toContain('removed from source')
    await unlink(join(source, 'rules/a.md'))
    const removed = await runStatus(dir)
    expect(removed.exitCode).toBe(0)
    expect(removed.output).toContain('removed from source')
  })
  it('warns when never synced', async () => {
    const dir = getDir()
    await writeConfig(
      dir,
      buildConfigYaml({
        assistants: ['claude-code'],
        localSource: {path: join(dir, 'source')},
      }),
    )

    const {exitCode, output} = await runStatus(dir)
    expect(exitCode).toBe(0)
    expect(output).toContain('No sync state found')
  })

  it('shows all in sync when nothing changed', async () => {
    const dir = getDir()
    await setupSynced(dir)

    const {exitCode, output} = await runStatus(dir)
    expect(exitCode).toBe(0)
    expect(output).toContain('in sync')
  })

  it('detects locally modified files', async () => {
    const dir = getDir()
    await setupSynced(dir)

    await writeFile(join(dir, '.claude/skills/deploy.md'), '# User Modified')

    const {exitCode, output} = await runStatus(dir)
    expect(exitCode).toBe(0)
    expect(output).toContain('locally modified')
    expect(output).toContain('1 file(s) modified locally')
  })

  it('detects locally deleted files', async () => {
    const dir = getDir()
    await setupSynced(dir)

    const {unlinkSync} = await import('node:fs')
    unlinkSync(join(dir, '.claude/skills/deploy.md'))

    const {exitCode, output} = await runStatus(dir)
    expect(exitCode).toBe(0)
    expect(output).toContain('deleted')
    expect(output).toContain('1 file(s) deleted locally')
  })

  it('shows mixed drift statuses', async () => {
    const dir = getDir()
    const sourceDir = join(dir, 'source')
    await writeSourceTree(sourceDir, {
      skills: {
        'deploy.md': '# Deploy',
        'review.md': '# Review',
        'test.md': '# Test',
      },
    })
    await writeConfig(
      dir,
      buildConfigYaml({
        assistants: ['claude-code'],
        localSource: {path: sourceDir},
      }),
    )
    await runSync(dir)

    // Modify one, delete one, leave one unchanged
    await writeFile(join(dir, '.claude/skills/deploy.md'), '# Changed')
    const {unlinkSync} = await import('node:fs')
    unlinkSync(join(dir, '.claude/skills/review.md'))

    const {exitCode, output} = await runStatus(dir)
    expect(exitCode).toBe(0)
    expect(output).toContain('locally modified')
    expect(output).toContain('deleted')
    expect(output).toContain('in sync')
  })

  it('exits non-zero when no config exists', async () => {
    const dir = getDir()

    const {exitCode, output} = await runStatus(dir)
    expect(exitCode).not.toBe(0)
    expect(output).toContain('No project config found')
  })
})
