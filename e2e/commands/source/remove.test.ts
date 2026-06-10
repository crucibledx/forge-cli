/**
 * E2E tests for `forge source remove`.
 */

import {existsSync} from 'node:fs'
import {mkdir} from 'node:fs/promises'
import {join} from 'node:path'

import {describe, expect, it} from 'bun:test'

import {SOURCE_COMMAND_MESSAGES as SCM} from '@application/commands/source/messages'
import {buildConfigYaml, writeConfig, writeSourceTree} from '@e2e/fixtures'
import {N, readConfig, runSource, runSourceSession, runSync, TIMEOUT_MS, useTmpDir, Y} from '@e2e/framework'

const getDir = useTmpDir('forge-source-remove')

describe('forge source remove', () => {
  it(
    'exits with error when no config exists',
    async () => {
      const dir = getDir()
      const {output, exitCode} = await runSourceSession(dir, 'remove', (cli) =>
        cli.waitForText('No project config found'),
      )
      expect(exitCode).toBe(1)
      expect(output).toContain('No project config found')
    },
    TIMEOUT_MS,
  )

  it(
    'warns when no sources to remove',
    async () => {
      const dir = getDir()
      await writeConfig(dir, buildConfigYaml({assistants: ['claude-code'], rawSources: '[]'}))

      const {output} = await runSourceSession(dir, 'remove', (cli) => cli.waitForText(SCM.errors.noSources))
      expect(output).toContain('No sources configured')
    },
    TIMEOUT_MS,
  )

  it(
    'removes a source without synced files (nothing to clean)',
    async () => {
      const dir = getDir()
      const localDir = join(dir, 'my-rules')
      await mkdir(localDir, {recursive: true})
      await writeConfig(
        dir,
        buildConfigYaml({assistants: ['claude-code'], localSource: {name: 'team', path: localDir}}),
      )

      await runSourceSession(dir, 'remove', (cli) =>
        cli
          // select which source (only one)
          .waitForText(SCM.remove.which)
          .pressEnter()
          // confirm removal
          .waitForText(SCM.remove.confirm('team'))
          .pressKey(Y)
          // no synced files
          .waitForText(SCM.remove.removed('team')),
      )

      const config = await readConfig(dir)
      expect(config.sources).toHaveLength(0)
    },
    TIMEOUT_MS,
  )

  it(
    'removes a source and cleans synced files',
    async () => {
      const dir = getDir()
      const sourceDir = join(dir, 'source')
      await writeSourceTree(sourceDir, {skills: {'deploy.md': '# Deploy', 'test.md': '# Test'}})
      await writeConfig(
        dir,
        buildConfigYaml({assistants: ['claude-code'], localSource: {name: 'team', path: sourceDir}}),
      )

      // sync first so files exist
      await runSync(dir)

      // verify files were synced
      const beforeList = await runSource(dir, 'list')
      expect(beforeList.output).toContain('synced file(s)')

      await runSourceSession(dir, 'remove', (cli) =>
        cli
          .waitForText(SCM.remove.which)
          .pressEnter()
          .waitForText(SCM.remove.confirm('team'))
          .pressKey(Y)
          // confirm file cleanup
          .waitForText('synced file(s) from this source')
          .pressKey(Y)
          .waitForText(SCM.remove.removed('team')),
      )

      const config = await readConfig(dir)
      expect(config.sources).toHaveLength(0)

      // verify synced files were deleted (skills/** → .claude/skills/)
      const skillsDir = join(dir, '.claude', 'skills')
      expect(existsSync(join(skillsDir, 'deploy.md'))).toBe(false)
      expect(existsSync(join(skillsDir, 'test.md'))).toBe(false)
    },
    TIMEOUT_MS,
  )

  it(
    'removes a source but keeps files when cleanup is declined',
    async () => {
      const dir = getDir()
      const sourceDir = join(dir, 'source')
      await writeSourceTree(sourceDir, {skills: {'keep.md': '# Keep me'}})
      await writeConfig(
        dir,
        buildConfigYaml({assistants: ['claude-code'], localSource: {name: 'team', path: sourceDir}}),
      )

      await runSync(dir)

      await runSourceSession(dir, 'remove', (cli) =>
        cli
          .waitForText(SCM.remove.which)
          .pressEnter()
          .waitForText(SCM.remove.confirm('team'))
          .pressKey(Y)
          // decline file cleanup
          .waitForText('synced file(s) from this source')
          .pressKey(N)
          .waitForText(SCM.remove.removed('team')),
      )

      const config = await readConfig(dir)
      expect(config.sources).toHaveLength(0)

      // files should still exist (skills/** → .claude/skills/)
      expect(existsSync(join(dir, '.claude', 'skills', 'keep.md'))).toBe(true)
    },
    TIMEOUT_MS,
  )
})
