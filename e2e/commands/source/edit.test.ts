/**
 * E2E tests for `forge source edit`.
 */

import {mkdir} from 'node:fs/promises'
import {join} from 'node:path'

import {describe, expect, it} from 'bun:test'

import {SOURCE_COMMAND_MESSAGES as SM} from '@application/commands/source/messages'
import {buildConfigYaml, writeConfig} from '@e2e/fixtures'
import {
  ARROW_DOWN,
  LOCAL_SOURCE_MESSAGES as LM,
  N,
  readConfig,
  runSourceSession,
  SOURCE_PROMPT_MESSAGES as SPM,
  TIMEOUT_MS,
  useTmpDir,
} from '@e2e/framework'

const getDir = useTmpDir('forge-source-edit')

describe('forge source edit', () => {
  it(
    'exits with error when no config exists',
    async () => {
      const {exitCode, output} = await runSourceSession(getDir(), 'edit', (cli) =>
        cli.waitForText('No project config found'),
      )
      expect(exitCode).toBe(1)
      expect(output).toContain('No project config found')
    },
    TIMEOUT_MS,
  )

  it(
    'shows no-sources warning when sources are empty',
    async () => {
      const dir = getDir()
      await writeConfig(dir, buildConfigYaml({assistants: ['cursor'], rawSources: '[]'}))

      const {output} = await runSourceSession(dir, 'edit', (cli) => cli.waitForText(SM.errors.noSources))
      expect(output).toContain(SM.errors.noSources)
    },
    TIMEOUT_MS,
  )

  it(
    'edits an existing local source path',
    async () => {
      const dir = getDir()
      const oldDir = join(dir, 'old-source')
      const newDir = join(dir, 'new-source')
      await mkdir(oldDir, {recursive: true})
      await mkdir(newDir, {recursive: true})
      await writeConfig(dir, buildConfigYaml({assistants: ['cursor'], localSource: {path: oldDir}}))

      await runSourceSession(dir, 'edit', (cli) =>
        cli
          // select which source to edit
          .waitForText(SM.edit.which)
          .pressEnter()
          // pick source type — Local is second option
          .waitForText(SPM.selectType)
          .pressKey(ARROW_DOWN)
          .pressEnter()
          // enter new path
          .waitForText(LM.path.message)
          .write(newDir)
          .pressEnter()
          // decline advanced options
          .waitForText(SPM.options.gate)
          .pressKey(N)
          // wait for success
          .waitForText('updated'),
      )

      const config = await readConfig(dir)
      expect(config.sources).toHaveLength(1)
      expect(config.sources[0].path).toBe(newDir)
    },
    TIMEOUT_MS,
  )
})
