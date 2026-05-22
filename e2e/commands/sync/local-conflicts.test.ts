/**
 * E2E tests for `forge sync` local conflict strategy.
 *
 * Covers: remote-wins (default), local-wins, error strategy when a locally modified file also changed remotely.
 * Also covers backup (.bak) creation.
 */

import {existsSync} from 'node:fs'
import {readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {describe, expect, it} from 'bun:test'

import {buildConfigYaml, readTarget, writeConfig, writeSourceTree} from '@e2e/fixtures'
import {runSync, useTmpDir} from '@e2e/framework'

const getDir = useTmpDir('forge-sync-local-conflict')

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Sets up a scenario where a local conflict exists:
 * 1. Sync once with original content (establishes sync state)
 * 2. Modify the local file (simulates user edit)
 * 3. Change the source (simulates remote update)
 */
async function setupLocalConflict(
  dir: string,
  options: {strategy?: string; backup?: boolean} = {},
): Promise<{sourceDir: string; targetFile: string}> {
  const sourceDir = join(dir, 'source')

  // Initial sync — establishes baseline in sync state
  await writeSourceTree(sourceDir, {skills: {'deploy.md': '# Original'}})
  const sync =
    options.strategy || options.backup !== undefined
      ? {local_conflict_strategy: options.strategy, backup: options.backup}
      : undefined
  await writeConfig(
    dir,
    buildConfigYaml({
      assistants: ['claude-code'],
      localSource: {path: sourceDir},
      sync,
    }),
  )
  await runSync(dir)

  // User edits the local file
  const targetFile = join(dir, '.claude/skills/deploy.md')
  await writeFile(targetFile, '# User Modified')

  // Source updates remotely
  await writeSourceTree(sourceDir, {skills: {'deploy.md': '# Remote Updated'}})

  return {sourceDir, targetFile}
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('forge sync — local conflicts', () => {
  it('remote-wins (default): overwrites locally modified file', async () => {
    const dir = getDir()
    const {targetFile} = await setupLocalConflict(dir)

    const {exitCode} = await runSync(dir)
    expect(exitCode).toBe(0)

    const content = await readFile(targetFile, 'utf-8')
    expect(content).toBe('# Remote Updated')
  })

  it('remote-wins (explicit): overwrites locally modified file', async () => {
    const dir = getDir()
    const {targetFile} = await setupLocalConflict(dir, {strategy: 'remote-wins'})

    const {exitCode} = await runSync(dir)
    expect(exitCode).toBe(0)

    const content = await readFile(targetFile, 'utf-8')
    expect(content).toBe('# Remote Updated')
  })

  it('local-wins: keeps locally modified file', async () => {
    const dir = getDir()
    const {targetFile} = await setupLocalConflict(dir, {strategy: 'local-wins'})

    const {exitCode, output} = await runSync(dir)
    expect(exitCode).toBe(0)

    const content = await readFile(targetFile, 'utf-8')
    expect(content).toBe('# User Modified')
    expect(output).toContain('0 files synced')
  })

  it('error: exits non-zero when local conflict detected', async () => {
    const dir = getDir()
    await setupLocalConflict(dir, {strategy: 'error'})

    const {exitCode, output} = await runSync(dir)
    expect(exitCode).not.toBe(0)
    expect(output).toContain('modified locally and remotely')
  })

  it('backup: creates .bak file when remote-wins overwrites', async () => {
    const dir = getDir()
    const {targetFile} = await setupLocalConflict(dir, {strategy: 'remote-wins', backup: true})

    const {exitCode} = await runSync(dir)
    expect(exitCode).toBe(0)

    const content = await readFile(targetFile, 'utf-8')
    expect(content).toBe('# Remote Updated')

    const bakFile = `${targetFile}.bak`
    expect(existsSync(bakFile)).toBe(true)
    const bakContent = await readFile(bakFile, 'utf-8')
    expect(bakContent).toBe('# User Modified')
  })

  it('backup enabled by default when remote-wins overwrites', async () => {
    const dir = getDir()
    const {targetFile} = await setupLocalConflict(dir)

    await runSync(dir)

    expect(existsSync(`${targetFile}.bak`)).toBe(true)
  })

  it('no backup when backup:false is set', async () => {
    const dir = getDir()
    const {targetFile} = await setupLocalConflict(dir, {strategy: 'remote-wins', backup: false})

    await runSync(dir)

    expect(existsSync(`${targetFile}.bak`)).toBe(false)
  })

  it('no conflict when only remote changed (local untouched)', async () => {
    const dir = getDir()
    const sourceDir = join(dir, 'source')

    // Initial sync
    await writeSourceTree(sourceDir, {skills: {'deploy.md': '# Original'}})
    await writeConfig(
      dir,
      buildConfigYaml({
        assistants: ['claude-code'],
        localSource: {path: sourceDir},
        sync: {local_conflict_strategy: 'error'},
      }),
    )
    await runSync(dir)

    // Only remote changes — no local edit
    await writeSourceTree(sourceDir, {skills: {'deploy.md': '# Remote Updated'}})

    const {exitCode} = await runSync(dir)
    expect(exitCode).toBe(0)

    const content = await readTarget(dir, '.claude/skills/deploy.md')
    expect(content).toBe('# Remote Updated')
  })

  it('no conflict when only local changed (remote untouched)', async () => {
    const dir = getDir()
    const sourceDir = join(dir, 'source')

    // Initial sync
    await writeSourceTree(sourceDir, {skills: {'deploy.md': '# Original'}})
    await writeConfig(
      dir,
      buildConfigYaml({
        assistants: ['claude-code'],
        localSource: {path: sourceDir},
        sync: {local_conflict_strategy: 'error'},
      }),
    )
    await runSync(dir)

    // Only local edit — remote unchanged
    await writeFile(join(dir, '.claude/skills/deploy.md'), '# User Modified')

    const {exitCode} = await runSync(dir)
    expect(exitCode).toBe(0)

    // remote-wins by default, but since remote == stored, no conflict → safe update
    // Wait — with strategy 'error', this should NOT conflict because remote hash == stored hash
    // The file will be overwritten to original content (remote-wins is irrelevant, it's just an update)
  })
})
