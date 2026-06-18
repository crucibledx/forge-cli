/**
 * E2E tests for `forge source add`.
 */

import {mkdir} from 'node:fs/promises'
import {join} from 'node:path'

import {describe, expect, it} from 'bun:test'

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

const getDir = useTmpDir('forge-source-add')

describe('forge source add', () => {
  it(
    'exits with error when no config exists',
    async () => {
      const dir = getDir()
      const {output, exitCode} = await runSourceSession(dir, 'add', (cli) => cli.waitForText('No project config found'))
      expect(exitCode).toBe(1)
      expect(output).toContain('No project config found')
    },
    TIMEOUT_MS,
  )

  it(
    'adds a local source interactively',
    async () => {
      const dir = getDir()
      const localDir = join(dir, 'my-rules')
      await mkdir(localDir, {recursive: true})
      await writeConfig(dir, buildConfigYaml({assistants: ['claude-code'], rawSources: '[]'}))

      const {output} = await runSourceSession(dir, 'add', (cli) =>
        cli
          // source name prompt — accept default
          .waitForText(SPM.name.message)
          .pressEnter()
          // source type — pick Local (second option)
          .waitForText(SPM.selectType)
          .pressKey(ARROW_DOWN)
          .pressEnter()
          // local path
          .waitForText(LM.path.message)
          .write(localDir)
          .pressEnter()
          // decline advanced filtering
          .waitForText(SPM.options.gate)
          .pressKey(N)
          // wait for success
          .waitForText('added'),
      )

      expect(output).toContain('added')

      const config = await readConfig(dir)
      expect(config.sources).toHaveLength(1)
      expect(config.sources[0].type).toBe('local')
      expect(config.sources[0].path).toBe(localDir)
    },
    TIMEOUT_MS,
  )

  it(
    'adds a second source preserving the first',
    async () => {
      const dir = getDir()
      const localDir1 = join(dir, 'source-a')
      const localDir2 = join(dir, 'source-b')
      await mkdir(localDir1, {recursive: true})
      await mkdir(localDir2, {recursive: true})
      await writeConfig(
        dir,
        buildConfigYaml({assistants: ['claude-code'], localSource: {name: 'first', path: localDir1}}),
      )

      await runSourceSession(dir, 'add', (cli) =>
        cli
          .waitForText(SPM.name.message)
          .write('second')
          .pressEnter()
          .waitForText(SPM.selectType)
          .pressKey(ARROW_DOWN)
          .pressEnter()
          .waitForText(LM.path.message)
          .write(localDir2)
          .pressEnter()
          .waitForText(SPM.options.gate)
          .pressKey(N)
          .waitForText('added'),
      )

      const config = await readConfig(dir)
      expect(config.sources).toHaveLength(2)
      expect(config.sources[0].name).toBe('first')
      expect(config.sources[1].name).toBe('second')
    },
    TIMEOUT_MS,
  )
})
