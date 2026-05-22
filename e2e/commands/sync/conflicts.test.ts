/**
 * E2E tests for `forge sync` source conflict resolution.
 *
 * Covers: last-wins (default), first-wins, error strategy when
 * multiple sources produce the same target path.
 */

import {join} from 'node:path'

import {describe, expect, it} from 'bun:test'

import {buildConfigYaml, readTarget, writeConfig, writeSourceTree} from '@e2e/fixtures'
import {runSync, useTmpDir} from '@e2e/framework'

const getDir = useTmpDir('forge-sync-conflicts')

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function setupTwoSources(
  dir: string,
  options: {strategy?: string} = {},
): Promise<{sourceA: string; sourceB: string}> {
  const sourceA = join(dir, 'source-a')
  const sourceB = join(dir, 'source-b')

  await writeSourceTree(sourceA, {skills: {'deploy.md': '# From Alpha'}})
  await writeSourceTree(sourceB, {skills: {'deploy.md': '# From Beta'}})

  await writeConfig(
    dir,
    buildConfigYaml({
      assistants: ['claude-code'],
      localSources: [
        {name: 'alpha', path: sourceA},
        {name: 'beta', path: sourceB},
      ],
      sync: options.strategy ? {source_conflict_strategy: options.strategy} : undefined,
    }),
  )

  return {sourceA, sourceB}
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('forge sync — source conflicts', () => {
  it('last-wins (default): later source overwrites earlier', async () => {
    const dir = getDir()
    await setupTwoSources(dir)

    const {exitCode} = await runSync(dir)
    expect(exitCode).toBe(0)

    const content = await readTarget(dir, '.claude/skills/deploy.md')
    expect(content).toBe('# From Beta')
  })

  it('last-wins (explicit): later source overwrites earlier', async () => {
    const dir = getDir()
    await setupTwoSources(dir, {strategy: 'last-wins'})

    const {exitCode} = await runSync(dir)
    expect(exitCode).toBe(0)

    const content = await readTarget(dir, '.claude/skills/deploy.md')
    expect(content).toBe('# From Beta')
  })

  it('first-wins: earlier source is kept', async () => {
    const dir = getDir()
    await setupTwoSources(dir, {strategy: 'first-wins'})

    const {exitCode} = await runSync(dir)
    expect(exitCode).toBe(0)

    const content = await readTarget(dir, '.claude/skills/deploy.md')
    expect(content).toBe('# From Alpha')
  })

  it('error: exits non-zero and reports conflict', async () => {
    const dir = getDir()
    await setupTwoSources(dir, {strategy: 'error'})

    const {exitCode, output} = await runSync(dir)
    expect(exitCode).not.toBe(0)
    expect(output).toContain('conflicting sources')
  })

  it('error: no conflict when sources produce different paths', async () => {
    const dir = getDir()
    const sourceA = join(dir, 'source-a')
    const sourceB = join(dir, 'source-b')

    await writeSourceTree(sourceA, {skills: {'deploy.md': '# Deploy'}})
    await writeSourceTree(sourceB, {skills: {'build.md': '# Build'}})

    await writeConfig(
      dir,
      buildConfigYaml({
        assistants: ['claude-code'],
        localSources: [
          {name: 'alpha', path: sourceA},
          {name: 'beta', path: sourceB},
        ],
        sync: {source_conflict_strategy: 'error'},
      }),
    )

    const {exitCode} = await runSync(dir)
    expect(exitCode).toBe(0)

    expect(await readTarget(dir, '.claude/skills/deploy.md')).toBe('# Deploy')
    expect(await readTarget(dir, '.claude/skills/build.md')).toBe('# Build')
  })
})
