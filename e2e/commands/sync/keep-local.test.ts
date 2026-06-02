/**
 * E2E tests for `keep_local` sync config option.
 *
 * Covers: default (keep), explicit keep_local:false deletes stale files,
 * keep_local:true preserves them, files still in source are never deleted.
 */

import {existsSync, rmSync} from 'node:fs'
import {writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {describe, expect, it} from 'bun:test'

import {buildConfigYaml, writeConfig, writeSourceTree} from '@e2e/fixtures'
import {runSync, useTmpDir} from '@e2e/framework'

const getDir = useTmpDir('forge-keep-local')

describe('keep_local', () => {
  it('keeps stale files by default (keep_local: true)', async () => {
    const dir = getDir()
    const sourceDir = join(dir, 'source')

    // First sync with a file
    await writeSourceTree(sourceDir, {skills: {'deploy.md': '# Deploy', 'review.md': '# Review'}})
    await writeConfig(dir, buildConfigYaml({assistants: ['claude-code'], localSource: {path: sourceDir}}))
    await runSync(dir)

    expect(existsSync(join(dir, '.claude/skills/deploy.md'))).toBe(true)
    expect(existsSync(join(dir, '.claude/skills/review.md'))).toBe(true)

    // Remove review.md from source, sync again
    rmSync(sourceDir, {recursive: true, force: true})
    await writeSourceTree(sourceDir, {skills: {'deploy.md': '# Deploy'}})
    await runSync(dir)

    // review.md should still exist (keep_local defaults to true)
    expect(existsSync(join(dir, '.claude/skills/review.md'))).toBe(true)
  })

  it('deletes stale files when keep_local is false', async () => {
    const dir = getDir()
    const sourceDir = join(dir, 'source')

    // First sync
    await writeSourceTree(sourceDir, {skills: {'deploy.md': '# Deploy', 'review.md': '# Review'}})
    await writeConfig(
      dir,
      buildConfigYaml({
        assistants: ['claude-code'],
        localSource: {path: sourceDir},
        sync: {keep_local: false},
      }),
    )
    await runSync(dir)

    expect(existsSync(join(dir, '.claude/skills/review.md'))).toBe(true)

    // Remove review.md from source, sync again
    rmSync(sourceDir, {recursive: true, force: true})
    await writeSourceTree(sourceDir, {skills: {'deploy.md': '# Deploy'}})
    await runSync(dir)

    // review.md should be deleted
    expect(existsSync(join(dir, '.claude/skills/review.md'))).toBe(false)
    // deploy.md should still exist
    expect(existsSync(join(dir, '.claude/skills/deploy.md'))).toBe(true)
  })

  it('shows deleted files in dry-run output', async () => {
    const dir = getDir()
    const sourceDir = join(dir, 'source')

    await writeSourceTree(sourceDir, {skills: {'deploy.md': '# Deploy', 'old.md': '# Old'}})
    await writeConfig(
      dir,
      buildConfigYaml({
        assistants: ['claude-code'],
        localSource: {path: sourceDir},
        sync: {keep_local: false},
      }),
    )
    await runSync(dir)

    // Remove old.md from source
    rmSync(sourceDir, {recursive: true, force: true})
    await writeSourceTree(sourceDir, {skills: {'deploy.md': '# Deploy'}})
    const {output} = await runSync(dir, ['--dry-run'])

    expect(output).toContain('removed from source')
    // File should still exist after dry-run
    expect(existsSync(join(dir, '.claude/skills/old.md'))).toBe(true)
  })

  it('does not delete locally modified files that are still in source', async () => {
    const dir = getDir()
    const sourceDir = join(dir, 'source')

    await writeSourceTree(sourceDir, {skills: {'deploy.md': '# Deploy'}})
    await writeConfig(
      dir,
      buildConfigYaml({
        assistants: ['claude-code'],
        localSource: {path: sourceDir},
        sync: {keep_local: false},
      }),
    )
    await runSync(dir)

    // Modify locally
    await writeFile(join(dir, '.claude/skills/deploy.md'), '# User changed')

    // Sync again — file is still in source, so it should NOT be deleted
    await runSync(dir)
    expect(existsSync(join(dir, '.claude/skills/deploy.md'))).toBe(true)
  })
})
