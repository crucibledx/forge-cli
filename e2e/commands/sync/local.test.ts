/**
 * E2E tests for `forge sync` with local source — core flow.
 *
 * Covers: file placement, dry-run, idempotency, update detection,
 * multi-assistant sync, empty source handling.
 */

import {existsSync} from 'node:fs'
import {mkdir} from 'node:fs/promises'
import {join} from 'node:path'

import {describe, expect, it} from 'bun:test'

import {
  buildConfigYaml,
  readTarget,
  RULE_WITH_PATHS,
  setupLocalSync,
  SKILL_DEPLOY,
  SKILL_DEPLOY_V1,
  SKILL_DEPLOY_V2,
  writeConfig,
  writeSourceTree,
} from '../../fixtures'
import {runSync, useTmpDir} from '../../framework'

// ─── Temp directory ──────────────────────────────────────────────────────────

const getDir = useTmpDir('forge-sync-local')

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('forge sync — local source', () => {
  it('syncs skills to claude-code destination', async () => {
    const dir = getDir()
    await setupLocalSync(dir, ['claude-code'], {skills: {'deploy.md': SKILL_DEPLOY}})

    const {exitCode} = await runSync(dir)
    expect(exitCode).toBe(0)

    expect(await readTarget(dir, '.claude/skills/deploy.md')).toBe(SKILL_DEPLOY)
  })

  it('syncs rules to claude-code without transforms', async () => {
    const dir = getDir()
    await setupLocalSync(dir, ['claude-code'], {rules: {'typescript.md': RULE_WITH_PATHS}})

    const {exitCode} = await runSync(dir)
    expect(exitCode).toBe(0)

    const content = await readTarget(dir, '.claude/rules/typescript.md')
    expect(content).toContain('paths:')
    expect(content).toContain('Use strict mode.')
  })

  it('syncs to multiple assistants simultaneously', async () => {
    const dir = getDir()
    await setupLocalSync(dir, ['claude-code', 'cursor', 'copilot', 'windsurf'], {
      skills: {'deploy.md': '# Deploy'},
      rules: {'api.md': RULE_WITH_PATHS},
    })

    await runSync(dir)

    // Claude Code — no transforms
    expect(await readTarget(dir, '.claude/skills/deploy.md')).toBe('# Deploy')
    expect(await readTarget(dir, '.claude/rules/api.md')).toContain('paths:')

    // Cursor — rename .md→.mdc + paths→globs
    expect(existsSync(join(dir, '.cursor/rules/api.mdc'))).toBe(true)
    expect(await readTarget(dir, '.cursor/rules/api.mdc')).toContain('globs:')

    // Copilot — rename .md→.instructions.md + paths→applyTo
    expect(existsSync(join(dir, '.github/instructions/api.instructions.md'))).toBe(true)
    expect(await readTarget(dir, '.github/instructions/api.instructions.md')).toContain('applyTo:')

    // Windsurf — paths→globs, filename unchanged
    expect(await readTarget(dir, '.windsurf/rules/api.md')).toContain('globs:')
  })

  it('reports no files when source directory is empty', async () => {
    const dir = getDir()
    const sourceDir = join(dir, 'source')
    await mkdir(sourceDir, {recursive: true})
    await writeConfig(dir, buildConfigYaml({assistants: ['claude-code'], localSource: {path: sourceDir}}))

    const {output, exitCode} = await runSync(dir)
    expect(exitCode).toBe(0)
    expect(output).toContain('No files')
  })

  it('--dry-run does not write files', async () => {
    const dir = getDir()
    await setupLocalSync(dir, ['claude-code'], {skills: {'deploy.md': SKILL_DEPLOY}})

    const {exitCode} = await runSync(dir, ['--dry-run'])
    expect(exitCode).toBe(0)

    expect(existsSync(join(dir, '.claude/skills/deploy.md'))).toBe(false)
  })

  it('detects no_change on second sync', async () => {
    const dir = getDir()
    await setupLocalSync(dir, ['claude-code'], {skills: {'deploy.md': SKILL_DEPLOY}})

    await runSync(dir)
    const {output} = await runSync(dir)

    expect(output).toContain('0 files synced')
  })

  it('detects update when source content changes', async () => {
    const dir = getDir()
    const sourceDir = join(dir, 'source')
    await writeSourceTree(sourceDir, {skills: {'deploy.md': SKILL_DEPLOY_V1}})
    await writeConfig(dir, buildConfigYaml({assistants: ['claude-code'], localSource: {path: sourceDir}}))

    await runSync(dir)

    await writeSourceTree(sourceDir, {skills: {'deploy.md': SKILL_DEPLOY_V2}})
    const {output} = await runSync(dir)

    expect(output).toContain('1 files synced')
    expect(await readTarget(dir, '.claude/skills/deploy.md')).toBe(SKILL_DEPLOY_V2)
  })
})
