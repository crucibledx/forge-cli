/**
 * E2E tests for `forge sync` with git source.
 *
 * Uses a local bare repo (no network) — creates a temp git repo, pushes files,
 * then configures forge to sync from it.
 */

import {describe, expect, it} from 'bun:test'

import {buildConfigYaml, readTarget, RULE_WITH_PATHS, SKILL_DEPLOY, writeConfig} from '@e2e/fixtures'
import {addBranchToBareRepo, createBareRepo, runSync, setBareRepoRef, useTmpDir} from '@e2e/framework'

const getDir = useTmpDir('forge-sync-git')

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('forge sync — git source', () => {
  it('syncs skills from a local bare repo', async () => {
    const dir = getDir()
    const repoPath = await createBareRepo(dir, {'skills/deploy.md': SKILL_DEPLOY})

    await writeConfig(dir, buildConfigYaml({assistants: ['claude-code'], gitSource: {url: repoPath}}))

    const {exitCode} = await runSync(dir)
    expect(exitCode).toBe(0)

    expect(await readTarget(dir, '.claude/skills/deploy.md')).toBe(SKILL_DEPLOY)
  }, 15_000)

  it('applies transforms from git source', async () => {
    const dir = getDir()
    const repoPath = await createBareRepo(dir, {'rules/api.md': RULE_WITH_PATHS})

    await writeConfig(dir, buildConfigYaml({assistants: ['cursor'], gitSource: {url: repoPath}}))

    await runSync(dir)

    const content = await readTarget(dir, '.cursor/rules/api.mdc')
    expect(content).toContain('globs:')
    expect(content).not.toContain('paths:')
    expect(content).toContain('Use strict mode.')
  }, 15_000)

  it('syncs from a custom branch', async () => {
    const dir = getDir()
    const repoPath = await createBareRepo(dir, {'skills/feature.md': '# Feature branch skill'}, 'develop')

    await writeConfig(
      dir,
      buildConfigYaml({assistants: ['claude-code'], gitSource: {url: repoPath, branch: 'develop'}}),
    )

    const {exitCode} = await runSync(dir)
    expect(exitCode).toBe(0)

    expect(await readTarget(dir, '.claude/skills/feature.md')).toBe('# Feature branch skill')
  }, 15_000)

  it('syncs two sources from same repo with different branches', async () => {
    const dir = getDir()
    const repoPath = await createBareRepo(dir, {'skills/deploy.md': SKILL_DEPLOY})
    await addBranchToBareRepo(dir, repoPath, 'team-rules', {'skills/review.md': '# Review skill'})

    const rawSources = [
      '  - name: default',
      '    type: git',
      `    url: "${repoPath}"`,
      '    branch: "main"',
      '  - name: team',
      '    type: git',
      `    url: "${repoPath}"`,
      '    branch: "team-rules"',
    ].join('\n')

    await writeConfig(dir, buildConfigYaml({assistants: ['claude-code'], rawSources}))

    const {exitCode} = await runSync(dir)
    expect(exitCode).toBe(0)

    expect(await readTarget(dir, '.claude/skills/deploy.md')).toBe(SKILL_DEPLOY)
    expect(await readTarget(dir, '.claude/skills/review.md')).toBe('# Review skill')
  }, 15_000)

  it('syncs a tag-pinned source again from its warm cache', async () => {
    const dir = getDir()
    const repoPath = await createBareRepo(dir, {'skills/deploy.md': SKILL_DEPLOY})
    await setBareRepoRef(dir, repoPath, 'refs/tags/v1.0.0', {'skills/deploy.md': SKILL_DEPLOY})

    await writeConfig(dir, buildConfigYaml({assistants: ['claude-code'], gitSource: {url: repoPath, branch: 'v1.0.0'}}))

    for (let sync = 0; sync < 2; sync++) {
      const {exitCode, stdout} = await runSync(dir)
      expect(stdout).not.toContain('Failed to fetch source')
      expect(exitCode).toBe(0)
      expect(await readTarget(dir, '.claude/skills/deploy.md')).toBe(SKILL_DEPLOY)
    }
  }, 30_000)

  it.each([
    ['tag', 'v1.0.0', 'refs/tags/v1.0.0'],
    ['branch', 'main', 'refs/heads/main'],
  ])(
    'a warm cache follows a %s that moved on the remote',
    async (_kind, ref, fullRef) => {
      const dir = getDir()
      const repoPath = await createBareRepo(dir, {'skills/deploy.md': SKILL_DEPLOY})
      await setBareRepoRef(dir, repoPath, fullRef, {'skills/deploy.md': SKILL_DEPLOY})

      await writeConfig(dir, buildConfigYaml({assistants: ['claude-code'], gitSource: {url: repoPath, branch: ref}}))

      expect((await runSync(dir)).exitCode).toBe(0)
      expect(await readTarget(dir, '.claude/skills/deploy.md')).toBe(SKILL_DEPLOY)

      await setBareRepoRef(dir, repoPath, fullRef, {'skills/review.md': '# Review skill'})
      const {exitCode, stdout} = await runSync(dir)
      expect(stdout).not.toContain('Failed to fetch source')
      expect(exitCode).toBe(0)
      expect(await readTarget(dir, '.claude/skills/review.md')).toBe('# Review skill')
    },
    30_000,
  )
})
