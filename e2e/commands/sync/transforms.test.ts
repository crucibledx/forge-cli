/**
 * E2E tests for `forge sync` transform pipeline.
 *
 * Covers: rename (.md→.mdc, .md→.instructions.md), frontmatter-rename
 * (paths→globs, paths→applyTo), body preservation, no-frontmatter passthrough.
 */

import {existsSync} from 'node:fs'
import {join} from 'node:path'

import {describe, expect, it} from 'bun:test'

import {readTarget, RULE_WITH_MULTI_PATHS, RULE_WITH_PATHS, setupLocalSync} from '../../fixtures'
import {runSync, useTmpDir} from '../../framework'

const getDir = useTmpDir('forge-sync-transforms')

async function setup(dir: string, assistants: string[], rules: Record<string, string>) {
  await setupLocalSync(dir, assistants, {rules})
}

// ─── Cursor: rename .md→.mdc + frontmatter paths→globs ──────────────────────

describe('forge sync transforms — cursor', () => {
  it('renames .md to .mdc', async () => {
    const dir = getDir()
    await setup(dir, ['cursor'], {'typescript.md': RULE_WITH_PATHS})

    await runSync(dir)

    expect(existsSync(join(dir, '.cursor/rules/typescript.mdc'))).toBe(true)
    expect(existsSync(join(dir, '.cursor/rules/typescript.md'))).toBe(false)
  })

  it('renames frontmatter paths → globs', async () => {
    const dir = getDir()
    await setup(dir, ['cursor'], {'typescript.md': RULE_WITH_PATHS})

    await runSync(dir)

    const content = await readTarget(dir, '.cursor/rules/typescript.mdc')
    expect(content).toContain('globs:')
    expect(content).not.toContain('paths:')
    expect(content).toContain('Use strict mode.')
  })

  it('preserves multiple frontmatter values and body through transforms', async () => {
    const dir = getDir()
    await setup(dir, ['cursor'], {'validation.md': RULE_WITH_MULTI_PATHS})

    await runSync(dir)

    const content = await readTarget(dir, '.cursor/rules/validation.mdc')
    expect(content).toContain('globs:')
    expect(content).toContain('src/api/**/*.ts')
    expect(content).toContain('src/core/**/*.ts')
    expect(content).toContain('All endpoints must validate input.')
    expect(content).toContain('Use zod for schemas.')
  })
})

// ─── Copilot: rename .md→.instructions.md + frontmatter paths→applyTo ───────

describe('forge sync transforms — copilot', () => {
  it('renames .md to .instructions.md', async () => {
    const dir = getDir()
    await setup(dir, ['copilot'], {'api.md': RULE_WITH_PATHS})

    await runSync(dir)

    expect(existsSync(join(dir, '.github/instructions/api.instructions.md'))).toBe(true)
    expect(existsSync(join(dir, '.github/instructions/api.md'))).toBe(false)
  })

  it('renames frontmatter paths → applyTo', async () => {
    const dir = getDir()
    await setup(dir, ['copilot'], {'api.md': RULE_WITH_PATHS})

    await runSync(dir)

    const content = await readTarget(dir, '.github/instructions/api.instructions.md')
    expect(content).toContain('applyTo:')
    expect(content).not.toContain('paths:')
    expect(content).toContain('Use strict mode.')
  })
})

// ─── Windsurf: frontmatter paths→globs only (no rename) ─────────────────────

describe('forge sync transforms — windsurf', () => {
  it('keeps original .md filename', async () => {
    const dir = getDir()
    await setup(dir, ['windsurf'], {'style.md': RULE_WITH_PATHS})

    await runSync(dir)

    expect(existsSync(join(dir, '.windsurf/rules/style.md'))).toBe(true)
  })

  it('renames frontmatter paths → globs', async () => {
    const dir = getDir()
    await setup(dir, ['windsurf'], {'style.md': RULE_WITH_PATHS})

    await runSync(dir)

    const content = await readTarget(dir, '.windsurf/rules/style.md')
    expect(content).toContain('globs:')
    expect(content).not.toContain('paths:')
  })
})

// ─── Claude Code: no transforms ──────────────────────────────────────────────

describe('forge sync transforms — claude-code', () => {
  it('passes through frontmatter without modification', async () => {
    const dir = getDir()
    await setup(dir, ['claude-code'], {'api.md': RULE_WITH_PATHS})

    await runSync(dir)

    const content = await readTarget(dir, '.claude/rules/api.md')
    expect(content).toContain('paths:')
    expect(content).toContain('Use strict mode.')
  })
})

// ─── No frontmatter passthrough ──────────────────────────────────────────────

describe('forge sync transforms — no frontmatter', () => {
  it('passes through rules without frontmatter unchanged', async () => {
    const dir = getDir()
    const ruleNoFrontmatter = 'Always use descriptive variable names.'
    await setup(dir, ['cursor'], {'naming.md': ruleNoFrontmatter})

    await runSync(dir)

    // Still renamed .md→.mdc but body is untouched
    const content = await readTarget(dir, '.cursor/rules/naming.mdc')
    expect(content).toBe(ruleNoFrontmatter)
  })
})
