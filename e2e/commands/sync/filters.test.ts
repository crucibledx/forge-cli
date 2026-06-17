/**
 * E2E tests for source-level include/exclude/map filters.
 *
 * Covers: include globs, exclude globs, map prefix, combined filters.
 */

import {existsSync} from 'node:fs'
import {join} from 'node:path'

import {describe, expect, it} from 'bun:test'

import {buildConfigYaml, readTarget, writeConfig, writeSourceTree} from '@e2e/fixtures'
import {runSync, useTmpDir} from '@e2e/framework'

const getDir = useTmpDir('forge-sync-filters')

function localSourceYaml(sourceDir: string, opts: {include?: string[]; exclude?: string[]; map?: string}): string {
  const lines = [`  - name: test-source`, `    type: local`, `    path: "${sourceDir}"`]
  if (opts.include) {
    lines.push(`    include:`)
    for (const p of opts.include) lines.push(`      - "${p}"`)
  }
  if (opts.exclude) {
    lines.push(`    exclude:`)
    for (const p of opts.exclude) lines.push(`      - "${p}"`)
  }
  if (opts.map) {
    lines.push(`    map: "${opts.map}"`)
  }
  return lines.join('\n')
}

describe('forge sync — include filter', () => {
  it('syncs only files matching include patterns', async () => {
    const dir = getDir()
    const sourceDir = join(dir, 'source')
    await writeSourceTree(sourceDir, {
      skills: {'deploy.md': '# Deploy', 'testing.md': '# Testing'},
      rules: {'api.md': '# API rule'},
    })

    const yaml = buildConfigYaml({
      assistants: ['claude-code'],
      rawSources: localSourceYaml(sourceDir, {include: ['skills/**']}),
    })
    await writeConfig(dir, yaml)

    const {exitCode} = await runSync(dir)
    expect(exitCode).toBe(0)

    expect(await readTarget(dir, '.claude/skills/deploy.md')).toBe('# Deploy')
    expect(await readTarget(dir, '.claude/skills/testing.md')).toBe('# Testing')
    expect(existsSync(join(dir, '.claude/rules/api.md'))).toBe(false)
  })

  it('supports exact file include', async () => {
    const dir = getDir()
    const sourceDir = join(dir, 'source')
    await writeSourceTree(sourceDir, {
      skills: {'deploy.md': '# Deploy', 'testing.md': '# Testing'},
    })

    const yaml = buildConfigYaml({
      assistants: ['claude-code'],
      rawSources: localSourceYaml(sourceDir, {include: ['skills/deploy.md']}),
    })
    await writeConfig(dir, yaml)

    const {exitCode} = await runSync(dir)
    expect(exitCode).toBe(0)

    expect(await readTarget(dir, '.claude/skills/deploy.md')).toBe('# Deploy')
    expect(existsSync(join(dir, '.claude/skills/testing.md'))).toBe(false)
  })
})

describe('forge sync — exclude filter', () => {
  it('excludes files matching patterns', async () => {
    const dir = getDir()
    const sourceDir = join(dir, 'source')
    await writeSourceTree(sourceDir, {
      skills: {'deploy.md': '# Deploy', 'internal.md': '# Internal'},
      rules: {'api.md': '# API'},
    })

    const yaml = buildConfigYaml({
      assistants: ['claude-code'],
      rawSources: localSourceYaml(sourceDir, {exclude: ['skills/internal.md']}),
    })
    await writeConfig(dir, yaml)

    const {exitCode} = await runSync(dir)
    expect(exitCode).toBe(0)

    expect(await readTarget(dir, '.claude/skills/deploy.md')).toBe('# Deploy')
    expect(await readTarget(dir, '.claude/rules/api.md')).toBe('# API')
    expect(existsSync(join(dir, '.claude/skills/internal.md'))).toBe(false)
  })
})

describe('forge sync — map prefix', () => {
  it('maps flat files into canonical structure', async () => {
    const dir = getDir()
    const sourceDir = join(dir, 'source')
    await writeSourceTree(sourceDir, {'SKILL.md': '# Draw.io skill'})

    const yaml = buildConfigYaml({
      assistants: ['claude-code'],
      rawSources: localSourceYaml(sourceDir, {map: 'skills'}),
    })
    await writeConfig(dir, yaml)

    const {exitCode} = await runSync(dir)
    expect(exitCode).toBe(0)

    expect(await readTarget(dir, '.claude/skills/SKILL.md')).toBe('# Draw.io skill')
  })

  it('maps nested source into canonical skills dir', async () => {
    const dir = getDir()
    const sourceDir = join(dir, 'source')
    await writeSourceTree(sourceDir, {drawio: {'SKILL.md': '# Draw.io'}})

    const yaml = buildConfigYaml({
      assistants: ['claude-code'],
      rawSources: localSourceYaml(sourceDir, {map: 'skills'}),
    })
    await writeConfig(dir, yaml)

    const {exitCode} = await runSync(dir)
    expect(exitCode).toBe(0)

    expect(await readTarget(dir, '.claude/skills/drawio/SKILL.md')).toBe('# Draw.io')
  })
})

describe('forge sync — combined filters', () => {
  it('include + exclude + map work together', async () => {
    const dir = getDir()
    const sourceDir = join(dir, 'source')
    await writeSourceTree(sourceDir, {
      'skill-cli': {drawio: {'SKILL.md': '# Draw.io'}},
      'mcp-server': {'index.ts': 'code'},
      'README.md': '# Docs',
    })

    const yaml = buildConfigYaml({
      assistants: ['claude-code'],
      rawSources: localSourceYaml(sourceDir, {
        include: ['skill-cli/**'],
        map: 'skills',
      }),
    })
    await writeConfig(dir, yaml)

    const {exitCode} = await runSync(dir)
    expect(exitCode).toBe(0)

    expect(await readTarget(dir, '.claude/skills/skill-cli/drawio/SKILL.md')).toBe('# Draw.io')
    expect(existsSync(join(dir, '.claude/skills/mcp-server'))).toBe(false)
    expect(existsSync(join(dir, '.claude/rules'))).toBe(false)
  })

  it('include + exclude narrows precisely', async () => {
    const dir = getDir()
    const sourceDir = join(dir, 'source')
    await writeSourceTree(sourceDir, {
      skills: {
        'deploy.md': '# Deploy',
        'testing.md': '# Testing',
        'internal.md': '# Internal',
      },
    })

    const yaml = buildConfigYaml({
      assistants: ['claude-code'],
      rawSources: localSourceYaml(sourceDir, {
        include: ['skills/**'],
        exclude: ['skills/internal.md'],
      }),
    })
    await writeConfig(dir, yaml)

    const {exitCode} = await runSync(dir)
    expect(exitCode).toBe(0)

    expect(await readTarget(dir, '.claude/skills/deploy.md')).toBe('# Deploy')
    expect(await readTarget(dir, '.claude/skills/testing.md')).toBe('# Testing')
    expect(existsSync(join(dir, '.claude/skills/internal.md'))).toBe(false)
  })
})
