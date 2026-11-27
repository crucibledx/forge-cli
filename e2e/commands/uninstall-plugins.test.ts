/**
 * E2E tests for removing Droid plugins, by sync and by `forge uninstall` (spec 0003 §5, AC-13).
 *
 * Removal deletes exactly forge's settings keys and cache entries; user sibling keys always survive,
 * keep_local never protects keys, and uninstall keeps a key the user edited, with a warning naming it.
 */

import {existsSync} from 'node:fs'
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {describe, expect, it} from 'bun:test'

import {buildConfigYaml, writeConfig, writeSourceTree} from '@e2e/fixtures'
import {pluginManifest} from '@e2e/fixtures/plugin-packages'
import {
  runCommand,
  runSync,
  runUninstallSession,
  TIMEOUT_MS,
  UNINSTALL_MESSAGES as M,
  useTmpDir,
  Y,
} from '@e2e/framework'

const getDir = useTmpDir('forge-uninstall-plugins')

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const readJson = async (path: string): Promise<any> => JSON.parse(await readFile(path, 'utf8'))

const miniPlugin = {
  'plugin.json': pluginManifest('hello', '1.0.0'),
  skills: {hello: {'SKILL.md': '---\nname: hello\ndescription: Say hello.\n---\n\nHello v1\n'}},
}

/** User-owned keys sharing the settings file with forge's keys; removal must never touch them. */
const SIBLINGS = {
  model: 'small',
  enabledPlugins: {'other@other-marketplace': true},
  extraKnownMarketplaces: {'other-marketplace': {source: {source: 'local', path: '/x'}}},
}
const seedSiblings = async (dir: string, settingsPath: string) => {
  await mkdir(join(dir, '.factory'), {recursive: true})
  await writeFile(join(dir, settingsPath), JSON.stringify(SIBLINGS, null, 2) + '\n')
}

const config = (dir: string, keepLocal: boolean, withPlugin: boolean) =>
  buildConfigYaml({assistants: ['droid'], localSource: {path: join(dir, 'src')}, sync: {keep_local: keepLocal}}) +
  (withPlugin
    ? `plugins:\n  - name: hello\n    source: {type: local, path: ${JSON.stringify(join(dir, 'plugin'))}}\n`
    : '')

/** Installs the mini plugin and returns the marketplace name from the written settings file. */
async function install(
  dir: string,
  keepLocal: boolean,
  settingsPath: string,
  run: () => Promise<{exitCode: number | null}>,
) {
  await writeSourceTree(join(dir, 'src'), {skills: {'a.md': '# A'}})
  await writeSourceTree(join(dir, 'plugin'), miniPlugin)
  await writeConfig(dir, config(dir, keepLocal, true))
  expect((await run()).exitCode).toBe(0)
  const settings = await readJson(join(dir, settingsPath))
  return Object.keys(settings.extraKnownMarketplaces ?? {})[0] as string
}

describe('removing a Droid plugin (AC-13)', () => {
  it('project scope, keep_local false: removes forge keys and cache, keeps user siblings', async () => {
    const dir = getDir()
    await seedSiblings(dir, '.factory/settings.local.json')
    await install(dir, false, '.factory/settings.local.json', () => runSync(dir))

    await writeConfig(dir, config(dir, false, false))
    const {exitCode, output} = await runSync(dir)
    expect(exitCode).toBe(0)
    expect(output).toContain('hello: removed')

    const settings = await readJson(join(dir, '.factory/settings.local.json'))
    expect(settings).toEqual(SIBLINGS)

    const cache = join(dir, '.crucible/plugins')
    expect(existsSync(join(cache, 'hello'))).toBe(false)
    expect(existsSync(join(cache, '.factory-plugin/marketplace.json'))).toBe(false)
    expect(existsSync(join(cache, '.claude-plugin/marketplace.json'))).toBe(false)
    expect((await readJson(join(dir, '.crucible/forge.lock'))).plugins).toEqual([])
  })

  it('project scope, keep_local true: key removal still runs, user siblings kept', async () => {
    const dir = getDir()
    await seedSiblings(dir, '.factory/settings.local.json')
    await install(dir, true, '.factory/settings.local.json', () => runSync(dir))

    await writeConfig(dir, config(dir, true, false))
    expect((await runSync(dir)).exitCode).toBe(0)

    const settings = await readJson(join(dir, '.factory/settings.local.json'))
    expect(settings).toEqual(SIBLINGS)
    expect(existsSync(join(dir, '.crucible/plugins/hello'))).toBe(false)
  })

  for (const keepLocal of [false, true]) {
    it(`user scope, keep_local ${keepLocal}: removes forge keys and the user cache, keeps user siblings`, async () => {
      const home = getDir()
      await seedSiblings(home, '.factory/settings.json')
      await install(home, keepLocal, '.factory/settings.json', () =>
        runCommand(home, '--global', ['sync'], {HOME: home}),
      )

      await writeConfig(home, config(home, keepLocal, false))
      expect((await runCommand(home, '--global', ['sync'], {HOME: home})).exitCode).toBe(0)

      const settings = await readJson(join(home, '.factory/settings.json'))
      expect(settings).toEqual(SIBLINGS)
      expect(existsSync(join(home, '.crucible/forge/plugins/hello'))).toBe(false)
    })
  }

  it('a key edited outside forge blocks removal without --force, and --force overrides it', async () => {
    const dir = getDir()
    const marketplace = await install(dir, false, '.factory/settings.local.json', () => runSync(dir))
    const settingsPath = join(dir, '.factory/settings.local.json')
    const settings = await readJson(settingsPath)
    settings.enabledPlugins[`hello@${marketplace}`] = false
    await writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n')

    await writeConfig(dir, config(dir, false, false))
    const blocked = await runSync(dir)
    expect(blocked.exitCode).toBe(1)
    expect(blocked.output).toContain('Planning failed')
    expect(await readFile(settingsPath, 'utf8')).toContain('crucible-forge')

    const forced = await runSync(dir, ['--force'])
    expect(forced.exitCode).toBe(0)
    expect(forced.output).toContain('--force overrides drift')
    expect(await readFile(settingsPath, 'utf8')).not.toContain('crucible-forge')
    expect(existsSync(join(dir, '.crucible/plugins/hello'))).toBe(false)
  })

  it(
    'forge uninstall removes forge keys and .crucible but keeps an edited key, warning with its name',
    async () => {
      const dir = getDir()
      const marketplace = await install(dir, true, '.factory/settings.local.json', () => runSync(dir))
      const settingsPath = join(dir, '.factory/settings.local.json')
      const settings = await readJson(settingsPath)
      settings.enabledPlugins[`hello@${marketplace}`] = false
      await writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n')

      const result = await runUninstallSession(dir, (cli) =>
        cli.waitForText('Continue?').pressKey(Y).waitForText(M.done),
      )

      expect(result.output).toContain(
        M.ownedKeyKept(`.factory/settings.local.json enabledPlugins["hello@${marketplace}"]`),
      )
      const after = await readJson(settingsPath)
      expect(after.enabledPlugins).toEqual({[`hello@${marketplace}`]: false})
      expect(after.extraKnownMarketplaces).toBeUndefined()
      expect(existsSync(join(dir, '.crucible'))).toBe(false)
    },
    TIMEOUT_MS,
  )
})
