/**
 * E2E tests for `forge sync` rollback on mutation failure.
 *
 * Covers: partial writes are rolled back when a mutation fails,
 * previously existing files are restored to their original content.
 */

import {existsSync} from 'node:fs'
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {describe, expect, it} from 'bun:test'

import {buildConfigYaml, writeConfig, writeSourceTree} from '@e2e/fixtures'
import {runSync, useTmpDir} from '@e2e/framework'

const getDir = useTmpDir('forge-sync-rollback')

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('forge sync — rollback', () => {
  it('rolls back written files when a later mutation fails', async () => {
    const dir = getDir()
    const sourceDir = join(dir, 'source')

    // Two assistants so we get two target dirs. Block one to cause partial failure.
    await writeSourceTree(sourceDir, {skills: {'deploy.md': '# Deploy'}})
    await writeConfig(dir, buildConfigYaml({assistants: ['claude-code', 'cursor'], localSource: {path: sourceDir}}))

    // Pre-create .claude target so we can verify rollback restores it
    await mkdir(join(dir, '.claude/skills'), {recursive: true})
    await writeFile(join(dir, '.claude/skills/deploy.md'), '# Original')

    // Block cursor's target: put a regular file where a directory should be
    // writeFile('.cursor/skills/deploy.md') needs mkdir('.cursor/skills/')
    // but if '.cursor/skills' is a file, mkdir fails
    await mkdir(join(dir, '.cursor'), {recursive: true})
    await writeFile(join(dir, '.cursor/skills'), 'blocker')

    const {exitCode, output} = await runSync(dir)
    expect(exitCode).not.toBe(0)
    expect(output).toContain('Rolling back')

    // .claude/skills/deploy.md should be rolled back to original content
    const restored = await readFile(join(dir, '.claude/skills/deploy.md'), 'utf-8')
    expect(restored).toBe('# Original')
  })

  it('removes new files that were created before failure', async () => {
    const dir = getDir()
    const sourceDir = join(dir, 'source')

    await writeSourceTree(sourceDir, {skills: {'deploy.md': '# Deploy'}})
    await writeConfig(dir, buildConfigYaml({assistants: ['claude-code', 'cursor'], localSource: {path: sourceDir}}))

    // Block cursor's target dir — file where directory should be
    await mkdir(join(dir, '.cursor'), {recursive: true})
    await writeFile(join(dir, '.cursor/skills'), 'blocker')

    const {exitCode, output} = await runSync(dir)
    expect(exitCode).not.toBe(0)

    expect(output).toContain('Failed')
    expect(output).toContain('Rollback complete')

    // claude-code file should have been rolled back (deleted since it was new)
    expect(existsSync(join(dir, '.claude/skills/deploy.md'))).toBe(false)
  })
})
