/**
 * E2E tests for `forge sync` with pre-structured source layouts.
 *
 * Covers: auto-detection of pre-structured vs canonical sources,
 * passthrough (no transforms) for assistant-specific directories,
 * and canonical transforms still applied when no assistant dirs detected.
 */

import {existsSync} from 'node:fs'
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'

import {describe, expect, it} from 'bun:test'

import {buildConfigYaml, writeConfig, writeSourceTree} from '@e2e/fixtures'
import {runSync, useTmpDir} from '@e2e/framework'

const getDir = useTmpDir('forge-sync-prestructured')

describe('sync — pre-structured source (auto-detected)', () => {
  it('copies .claude/ files as-is without transforms', async () => {
    const dir = getDir()
    const sourceDir = join(dir, 'source')
    await writeSourceTree(sourceDir, {
      '.claude': {rules: {'api.md': '---\npaths:\n  - "src/**"\n---\n# API Rules'}},
    })
    await writeConfig(
      dir,
      buildConfigYaml({
        assistants: ['claude-code'],
        localSource: {path: sourceDir},
      }),
    )

    const {exitCode} = await runSync(dir)
    expect(exitCode).toBe(0)

    const content = await readFile(join(dir, '.claude', 'rules', 'api.md'), 'utf-8')
    // Pre-structured: frontmatter stays as "paths" (no rename to "globs")
    expect(content).toContain('paths:')
  })

  it('copies files for multiple assistants', async () => {
    const dir = getDir()
    const sourceDir = join(dir, 'source')
    await writeSourceTree(sourceDir, {
      '.claude': {rules: {'api.md': '# Claude rule'}},
      '.cursor': {rules: {'api.mdc': '# Cursor rule'}},
    })
    await writeConfig(
      dir,
      buildConfigYaml({
        assistants: ['claude-code', 'cursor'],
        localSource: {path: sourceDir},
      }),
    )

    const {exitCode} = await runSync(dir)
    expect(exitCode).toBe(0)

    expect(existsSync(join(dir, '.claude', 'rules', 'api.md'))).toBe(true)
    expect(existsSync(join(dir, '.cursor', 'rules', 'api.mdc'))).toBe(true)
  })

  it('skips files for disabled assistants', async () => {
    const dir = getDir()
    const sourceDir = join(dir, 'source')
    await writeSourceTree(sourceDir, {
      '.claude': {rules: {'api.md': '# Claude rule'}},
      '.cursor': {rules: {'api.mdc': '# Cursor rule'}},
    })
    await writeConfig(
      dir,
      buildConfigYaml({
        assistants: ['claude-code'],
        localSource: {path: sourceDir},
      }),
    )

    const {exitCode} = await runSync(dir)
    expect(exitCode).toBe(0)

    expect(existsSync(join(dir, '.claude', 'rules', 'api.md'))).toBe(true)
    expect(existsSync(join(dir, '.cursor', 'rules', 'api.mdc'))).toBe(false)
  })
})

describe('sync — canonical source (auto-detected)', () => {
  it('applies transforms when source has canonical layout', async () => {
    const dir = getDir()
    const sourceDir = join(dir, 'source')
    await writeSourceTree(sourceDir, {
      rules: {'api.md': '---\npaths:\n  - "src/**"\n---\n# API Rules'},
    })
    await writeConfig(
      dir,
      buildConfigYaml({
        assistants: ['windsurf'],
        localSource: {path: sourceDir},
      }),
    )

    const {exitCode} = await runSync(dir)
    expect(exitCode).toBe(0)

    // Windsurf gets frontmatter rename: paths → globs
    const content = await readFile(join(dir, '.windsurf', 'rules', 'api.md'), 'utf-8')
    expect(content).toContain('globs:')
    expect(content).not.toContain('paths:')
  })
})

describe('sync — hybrid source (mixed canonical + pre-structured)', () => {
  it('copies pre-structured files as-is and transforms canonical files', async () => {
    const dir = getDir()
    const sourceDir = join(dir, 'source')
    await writeSourceTree(sourceDir, {
      '.claude': {rules: {'claude-only.md': '# Claude-specific rule'}},
      rules: {'shared.md': '---\npaths:\n  - "src/**"\n---\n# Shared rule'},
    })
    await writeConfig(
      dir,
      buildConfigYaml({
        assistants: ['claude-code', 'windsurf'],
        localSource: {path: sourceDir},
      }),
    )

    const {exitCode} = await runSync(dir)
    expect(exitCode).toBe(0)

    // Pre-structured: claude-only.md copied as-is
    const claudeOnly = await readFile(join(dir, '.claude', 'rules', 'claude-only.md'), 'utf-8')
    expect(claudeOnly).toBe('# Claude-specific rule')

    // Canonical: shared.md distributed to both assistants with transforms
    const claudeShared = await readFile(join(dir, '.claude', 'rules', 'shared.md'), 'utf-8')
    expect(claudeShared).toContain('paths:') // Claude has no frontmatter rename

    const windsurfShared = await readFile(join(dir, '.windsurf', 'rules', 'shared.md'), 'utf-8')
    expect(windsurfShared).toContain('globs:') // Windsurf renames paths → globs
    expect(windsurfShared).not.toContain('paths:')
  })

  it('pre-structured files are not duplicated to other assistants', async () => {
    const dir = getDir()
    const sourceDir = join(dir, 'source')
    await writeSourceTree(sourceDir, {
      '.claude': {rules: {'claude-only.md': '# Claude only'}},
      rules: {'shared.md': '# Shared'},
    })
    await writeConfig(
      dir,
      buildConfigYaml({
        assistants: ['claude-code', 'windsurf'],
        localSource: {path: sourceDir},
      }),
    )

    const {exitCode} = await runSync(dir)
    expect(exitCode).toBe(0)

    // claude-only.md should NOT appear in windsurf
    expect(existsSync(join(dir, '.windsurf', 'rules', 'claude-only.md'))).toBe(false)

    // shared.md should appear in both
    expect(existsSync(join(dir, '.claude', 'rules', 'shared.md'))).toBe(true)
    expect(existsSync(join(dir, '.windsurf', 'rules', 'shared.md'))).toBe(true)
  })
})
