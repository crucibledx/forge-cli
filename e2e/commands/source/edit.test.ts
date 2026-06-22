/**
 * E2E tests for `forge source edit`.
 */

import {mkdir, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {describe, expect, it} from 'bun:test'

import {SOURCE_COMMAND_MESSAGES as SM} from '@application/commands/source/messages'
import {buildConfigYaml, writeConfig} from '@e2e/fixtures'
import {
  BACKSPACE,
  configFilePath,
  LOCAL_SOURCE_MESSAGES as LM,
  N,
  readConfig,
  runSourceSession,
  SOURCE_PROMPT_MESSAGES as SPM,
  TIMEOUT_MS,
  useTmpDir,
  Y,
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
          // source type — Local is pre-selected via initialValue
          .waitForText(SPM.selectType)
          .pressEnter()
          // clear pre-filled path and enter new path
          .waitForText(LM.path.message)
          .write(BACKSPACE.repeat(300) + newDir)
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

  it(
    'keeps current path when pressing Enter on pre-filled local source',
    async () => {
      const dir = getDir()
      const sourceDir = join(dir, 'my-source')
      await mkdir(sourceDir, {recursive: true})
      await writeConfig(dir, buildConfigYaml({assistants: ['cursor'], localSource: {path: sourceDir}}))

      await runSourceSession(dir, 'edit', (cli) =>
        cli
          // select which source to edit
          .waitForText(SM.edit.which)
          .pressEnter()
          // source type — Local pre-selected, just press Enter
          .waitForText(SPM.selectType)
          .pressEnter()
          // path — pre-filled with current value, press Enter to keep it
          .waitForText(LM.path.message)
          .pressEnter()
          // decline advanced options
          .waitForText(SPM.options.gate)
          .pressKey(N)
          // wait for success
          .waitForText('updated'),
      )

      const config = await readConfig(dir)
      expect(config.sources).toHaveLength(1)
      expect(config.sources[0].path).toBe(sourceDir)
    },
    TIMEOUT_MS,
  )

  it(
    'preserves advanced source options when pressing Enter through pre-filled fields',
    async () => {
      const dir = getDir()
      const sourceDir = join(dir, 'adv-source')
      await mkdir(sourceDir, {recursive: true})

      // Write config with advanced options directly
      const yaml = [
        'version: "1"',
        'assistants:',
        '  - id: cursor',
        '    enabled: true',
        'sources:',
        '  - name: default',
        '    type: local',
        `    path: "${sourceDir}"`,
        '    include:',
        '      - "skills/**"',
        '    exclude:',
        '      - ".internal/**"',
        '    map: frontend',
        '',
      ].join('\n')
      await mkdir(join(dir, '.crucible'), {recursive: true})
      await writeFile(configFilePath(dir), yaml)

      await runSourceSession(dir, 'edit', (cli) =>
        cli
          // select which source
          .waitForText(SM.edit.which)
          .pressEnter()
          // source type — Local pre-selected
          .waitForText(SPM.selectType)
          .pressEnter()
          // path — pre-filled, keep it
          .waitForText(LM.path.message)
          .pressEnter()
          // advanced options gate — defaults to Yes (has existing options)
          .waitForText(SPM.options.gate)
          .pressKey(Y)
          // layout — press Enter to keep current
          .waitForText(SPM.options.layout.message)
          .pressEnter()
          // include — pre-filled with "skills/**", press Enter to keep
          .waitForText(SPM.options.include.message)
          .pressEnter()
          // exclude — pre-filled with ".internal/**", press Enter to keep
          .waitForText(SPM.options.exclude.message)
          .pressEnter()
          // map — pre-filled with "frontend", press Enter to keep
          .waitForText(SPM.options.map.message)
          .pressEnter()
          // wait for success
          .waitForText('updated'),
      )

      const config = await readConfig(dir)
      expect(config.sources).toHaveLength(1)
      const source = config.sources[0]
      expect(source.path).toBe(sourceDir)
      expect(source.include).toEqual(['skills/**'])
      expect(source.exclude).toEqual(['.internal/**'])
      expect(source.map).toBe('frontend')
    },
    TIMEOUT_MS,
  )
})
