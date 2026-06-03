/**
 * E2E tests for `forge config`.
 *
 * Strategy: spawn the CLI in a real PTY so that @clack/prompts enters raw mode.
 * Use waitForText() before each input — fully deterministic, no fixed sleeps.
 */

import {mkdir} from 'node:fs/promises'
import {join} from 'node:path'

import {describe, expect, it} from 'bun:test'

import {CONFIG_MESSAGES as M} from '@application/commands/config/messages'
import {ASSISTANTS_MESSAGES as AM} from '@application/commands/config/sections/assistants'
import {SOURCE_MESSAGES as SM} from '@application/commands/config/sections/source'
import {LOCAL_SOURCE_MESSAGES as LM} from '@infrastructure/source'
import {
  ARROW_DOWN,
  configFilePath,
  N,
  readConfig,
  runConfigSession,
  SOURCE_PROMPT_MESSAGES as SPM,
  TIMEOUT_MS,
  useTmpDir,
  Y,
} from '@e2e/framework'

// ─── Temp directory ───────────────────────────────────────────────────────────

const getDir = useTmpDir('forge-config-e2e')

function writeConfig(dir: string, yaml: string) {
  return Bun.write(configFilePath(dir), yaml)
}

const EMPTY_CONFIG = 'version: "1"\nassistants: []\nsources: []\n'
const WITH_CURSOR = 'version: "1"\nassistants:\n  - id: cursor\n    enabled: true\nsources: []\n'

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('forge config — e2e', () => {
  // ── Guard paths ──────────────────────────────────────────────────────

  it(
    'shows no-config warning when no config file exists',
    async () => {
      const {output} = await runConfigSession(getDir(), (cli) => cli.waitForText(M.noConfig))
      expect(output).toContain(M.noConfig)
    },
    TIMEOUT_MS,
  )

  // ── Section select ───────────────────────────────────────────────────

  it(
    'shows section select prompt with both sections listed',
    async () => {
      await writeConfig(getDir(), EMPTY_CONFIG)

      const {output} = await runConfigSession(getDir(), (cli) =>
        cli
          .waitForText(M.selectSection)
          .pressEnter()
          .waitForText(AM.select)
          .pressEnter()
          .waitForText(M.changeAnother)
          .pressKey(N),
      )
      expect(output).toContain(M.selectSection)
      expect(output).toContain('Assistants')
      expect(output).toContain('Scheduler')
      expect(output).toContain('Sources')
    },
    TIMEOUT_MS,
  )

  // ── Assistants section ───────────────────────────────────────────────

  it(
    'updates assistants via config command',
    async () => {
      await writeConfig(getDir(), WITH_CURSOR)

      await runConfigSession(getDir(), (cli) =>
        cli
          .waitForText(M.selectSection)
          .pressEnter()
          .waitForText(AM.select)
          .pressEnter()
          .waitForText(M.changeAnother)
          .pressKey(N),
      )

      const config = await readConfig(getDir())
      expect(config.assistants).toBeDefined()
    },
    TIMEOUT_MS,
  )

  // ── Sources section — add local ──────────────────────────────────────

  it(
    'adds a local source via the sources section',
    async () => {
      await writeConfig(getDir(), EMPTY_CONFIG)
      // create a local directory to use as source
      const localSourceDir = join(getDir(), 'my-configs')
      await mkdir(localSourceDir, {recursive: true})

      await runConfigSession(getDir(), (cli) =>
        // pick Sources (third option — after Assistants, Scheduler)
        cli
          .waitForText(M.selectSection)
          .pressKey(ARROW_DOWN)
          .pressKey(ARROW_DOWN)
          .pressEnter()
          // pick "Add a new source" — menu: Add(0) Done(1)
          .waitForText(SM.action)
          .pressEnter()
          // accept default source name
          .waitForText(SPM.name.message)
          .pressEnter()
          // pick local directory (second option: Git=0, Local=1)
          .waitForText(SM.addType)
          .pressKey(ARROW_DOWN)
          .pressEnter()
          // type path
          .waitForText(LM.path.message)
          .write(localSourceDir)
          .pressEnter()
          // wait for Edit label (unique to post-add menu: Add(0) Done(1) Edit(2) Remove(3))
          // then pick Done at index 1
          .waitForText(SM.actionEdit)
          .pressKey(ARROW_DOWN)
          .pressEnter()
          // decline changing another section
          .waitForText(M.changeAnother)
          .pressKey(N),
      )

      const config = await readConfig(getDir())
      expect(config.sources).toHaveLength(1)
      expect(config.sources[0].type).toBe('local')
    },
    TIMEOUT_MS,
  )

  // ── Sources section — remove ─────────────────────────────────────────

  it(
    'removes a source via the sources section',
    async () => {
      const localSourceDir = join(getDir(), 'my-configs')
      await mkdir(localSourceDir, {recursive: true})

      await writeConfig(
        getDir(),
        `version: "1"\nassistants: []\nsources:\n  - name: default\n    type: local\n    path: ${localSourceDir}\n`,
      )

      await runConfigSession(getDir(), (cli) =>
        // pick Sources (third option — after Assistants, Scheduler)
        cli
          .waitForText(M.selectSection)
          .pressKey(ARROW_DOWN)
          .pressKey(ARROW_DOWN)
          .pressEnter()
          // pick "Remove a source" — menu: Add(0) Done(1) Edit(2) Remove(3) → 3 downs
          .waitForText(SM.action)
          .pressKey(ARROW_DOWN)
          .pressKey(ARROW_DOWN)
          .pressKey(ARROW_DOWN)
          .pressEnter()
          // pick which to remove (only one: "default")
          .waitForText(SM.removeWhich)
          .pressEnter()
          // confirm removal
          .waitForText(SM.confirmRemove('default'))
          .pressKey(Y)
          // wait for removal message; now empty: Add(0) Done(1) → 1 down
          .waitForText(SM.removed('default'))
          .pressKey(ARROW_DOWN)
          .pressEnter()
          // decline changing another section
          .waitForText(M.changeAnother)
          .pressKey(N),
      )

      const config = await readConfig(getDir())
      expect(config.sources).toHaveLength(0)
    },
    TIMEOUT_MS,
  )

  // ── Sources section — done immediately ───────────────────────────────

  it(
    'exits source section immediately with Done',
    async () => {
      await writeConfig(getDir(), EMPTY_CONFIG)

      const {output} = await runConfigSession(getDir(), (cli) =>
        // pick Sources (third option — after Assistants, Scheduler)
        cli
          .waitForText(M.selectSection)
          .pressKey(ARROW_DOWN)
          .pressKey(ARROW_DOWN)
          .pressEnter()
          // pick Done — menu: Add(0) Done(1) → 1 down
          .waitForText(SM.action)
          .pressKey(ARROW_DOWN)
          .pressEnter()
          // decline changing another section
          .waitForText(M.changeAnother)
          .pressKey(N),
      )

      const config = await readConfig(getDir())
      expect(config.sources).toHaveLength(0)
      expect(output).toContain(M.outro)
    },
    TIMEOUT_MS,
  )
})
