/**
 * E2E tests for `forge source list`.
 */

import {join} from 'node:path'

import {describe, expect, it} from 'bun:test'

import {buildConfigYaml, writeConfig, writeSourceTree} from '@e2e/fixtures'
import {runSource, runSync, useTmpDir} from '@e2e/framework'

const getDir = useTmpDir('forge-source-list')

describe('forge source list', () => {
  it('exits with error when no config exists', async () => {
    const dir = getDir()
    const result = await runSource(dir, 'list')
    expect(result.exitCode).toBe(1)
    expect(result.output).toContain('No project config found')
  })

  it('warns when no sources configured', async () => {
    const dir = getDir()
    await writeConfig(
      dir,
      buildConfigYaml({
        assistants: ['claude-code'],
        rawSources: '[]',
      }),
    )

    const result = await runSource(dir, 'list')
    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('No sources configured')
  })

  it('shows configured sources', async () => {
    const dir = getDir()
    const sourceDir = join(dir, 'source')
    await writeSourceTree(sourceDir, {skills: {'deploy.md': '# Deploy'}})
    await writeConfig(
      dir,
      buildConfigYaml({
        assistants: ['claude-code'],
        localSource: {path: sourceDir},
      }),
    )

    const result = await runSource(dir, 'list')
    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('test-source')
    expect(result.output).toContain('local')
    expect(result.output).toContain('not synced yet')
  })

  it('shows synced file counts after sync', async () => {
    const dir = getDir()
    const sourceDir = join(dir, 'source')
    await writeSourceTree(sourceDir, {skills: {'deploy.md': '# Deploy', 'test.md': '# Test'}})
    await writeConfig(
      dir,
      buildConfigYaml({
        assistants: ['claude-code'],
        localSource: {path: sourceDir},
      }),
    )

    await runSync(dir)
    const result = await runSource(dir, 'list')

    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('synced file(s)')
  })

  it('shows advanced source options in list', async () => {
    const dir = getDir()
    const yaml = [
      'version: "1"',
      'assistants:',
      '  - id: cursor',
      '    enabled: true',
      'sources:',
      '  - name: filtered',
      '    type: local',
      `    path: "${dir}"`,
      '    layout: canonical',
      '    include:',
      '      - "skills/**"',
      '    exclude:',
      '      - "draft-*"',
      '    map: team',
      '',
    ].join('\n')
    await writeConfig(dir, yaml)

    const result = await runSource(dir, 'list')
    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('layout:canonical')
    expect(result.output).toContain('include:skills/**')
    expect(result.output).toContain('exclude:draft-*')
    expect(result.output).toContain('map:team')
  })

  it('behaves like list when no subcommand given', async () => {
    const dir = getDir()
    const sourceDir = join(dir, 'source')
    await writeSourceTree(sourceDir, {skills: {'deploy.md': '# Deploy'}})
    await writeConfig(
      dir,
      buildConfigYaml({
        assistants: ['claude-code'],
        localSource: {path: sourceDir},
      }),
    )

    const listResult = await runSource(dir, 'list')
    expect(listResult.exitCode).toBe(0)
    expect(listResult.output).toContain('test-source')
  })
})
