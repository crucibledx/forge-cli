/**
 * E2E tests for `forge config show`.
 */

import {join} from 'node:path'

import {describe, expect, it} from 'bun:test'

import {buildConfigYaml, writeConfig, writeSourceTree} from '@e2e/fixtures'
import {runConfigShow, SHOW_MESSAGES, TIMEOUT_MS, useTmpDir} from '@e2e/framework'

const getDir = useTmpDir('forge-config-show')

describe('forge config show', () => {
  it(
    'warns when no config exists',
    async () => {
      const result = await runConfigShow(getDir())
      expect(result.exitCode).toBe(0)
      expect(result.output).toContain(SHOW_MESSAGES.noConfig)
    },
    TIMEOUT_MS,
  )

  it(
    'shows assistants',
    async () => {
      const dir = getDir()
      await writeConfig(dir, buildConfigYaml({assistants: ['cursor', 'claude-code']}))
      const result = await runConfigShow(dir)
      expect(result.exitCode).toBe(0)
      expect(result.output).toContain('Cursor')
      expect(result.output).toContain('Claude Code')
    },
    TIMEOUT_MS,
  )

  it(
    'shows local source',
    async () => {
      const dir = getDir()
      const sourceDir = join(dir, 'source')
      await writeSourceTree(sourceDir, {skills: {'deploy.md': '# Deploy'}})
      await writeConfig(dir, buildConfigYaml({assistants: ['cursor'], localSource: {path: sourceDir}}))
      const result = await runConfigShow(dir)
      expect(result.exitCode).toBe(0)
      expect(result.output).toContain('test-source')
      expect(result.output).toContain('local')
      expect(result.output).toContain(sourceDir)
    },
    TIMEOUT_MS,
  )

  it(
    'shows git source with url and branch',
    async () => {
      const dir = getDir()
      await writeConfig(
        dir,
        buildConfigYaml({
          assistants: ['cursor'],
          gitSource: {url: 'git@github.com:org/repo.git', branch: 'develop'},
        }),
      )
      const result = await runConfigShow(dir)
      expect(result.exitCode).toBe(0)
      expect(result.output).toContain('git@github.com:org/repo.git')
      expect(result.output).toContain('develop')
    },
    TIMEOUT_MS,
  )

  it(
    'shows sync defaults with (default) markers',
    async () => {
      const dir = getDir()
      await writeConfig(dir, buildConfigYaml({assistants: ['cursor']}))
      const result = await runConfigShow(dir)
      expect(result.exitCode).toBe(0)
      expect(result.output).toContain('last-wins')
      expect(result.output).toContain('remote-wins')
      expect(result.output).toContain('(default)')
    },
    TIMEOUT_MS,
  )

  it(
    'shows non-default sync settings',
    async () => {
      const dir = getDir()
      await writeConfig(
        dir,
        buildConfigYaml({
          assistants: ['cursor'],
          sync: {source_conflict_strategy: 'error', local_conflict_strategy: 'local-wins', backup: false},
        }),
      )
      const result = await runConfigShow(dir)
      expect(result.exitCode).toBe(0)
      expect(result.output).toContain('error')
      expect(result.output).toContain('local-wins')
      expect(result.output).toContain('off')
    },
    TIMEOUT_MS,
  )

  it(
    'shows schedule with cron description',
    async () => {
      const dir = getDir()
      await writeConfig(
        dir,
        buildConfigYaml({
          assistants: ['cursor'],
          sync: {schedule: '0 9 * * *'},
        }),
      )
      const result = await runConfigShow(dir)
      expect(result.exitCode).toBe(0)
      expect(result.output).toContain('0 9 * * *')
      expect(result.output).toContain('09:00')
    },
    TIMEOUT_MS,
  )

  it(
    'shows advanced source options (layout, include, exclude, map)',
    async () => {
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
      const result = await runConfigShow(dir)
      expect(result.exitCode).toBe(0)
      expect(result.output).toContain('canonical')
      expect(result.output).toContain('skills/**')
      expect(result.output).toContain('draft-*')
      expect(result.output).toContain('team')
    },
    TIMEOUT_MS,
  )

  it(
    'shows none for empty assistants',
    async () => {
      const dir = getDir()
      await writeConfig(dir, buildConfigYaml({assistants: [], rawSources: '[]'}))
      const result = await runConfigShow(dir)
      expect(result.exitCode).toBe(0)
      expect(result.output).toContain('none')
    },
    TIMEOUT_MS,
  )
})
