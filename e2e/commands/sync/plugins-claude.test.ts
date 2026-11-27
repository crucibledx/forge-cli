/**
 * E2E tests for plugin delivery in `forge sync` (spec 0003 §4–§5), Claude Code side.
 *
 * Covers AC-10 and the Claude Code halves of AC-3, AC-4, AC-5, AC-6, AC-7, AC-8, AC-13, AC-14, AC-16, AC-17 and AC-24.
 */

import {existsSync} from 'node:fs'
import {chmod, mkdir, readdir, readFile, realpath, stat, writeFile} from 'node:fs/promises'
import {delimiter, dirname, join, relative} from 'node:path'

import {describe, expect, it} from 'bun:test'

import {buildConfigYaml, writeConfig, writeSourceTree} from '@e2e/fixtures'
import type {SyncConfigOptions} from '@e2e/fixtures/configs'
import {COVER_ALL_DIR, HELLO_PLUGIN_V1, HELLO_PLUGIN_V2, pluginManifest} from '@e2e/fixtures/plugin-packages'
import {
  bareRepoCommit,
  createBareRepo,
  runCommand,
  runSync,
  runUninstallSession,
  setBareRepoRef,
  TIMEOUT_MS,
  UNINSTALL_MESSAGES,
  useTmpDir,
  Y,
} from '@e2e/framework'

const getDir = useTmpDir('forge-sync-claude-plugins')

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const readJson = async (path: string): Promise<any> => JSON.parse(await readFile(path, 'utf8'))

const COVER_ALL_CLAUDE = join(dirname(COVER_ALL_DIR), 'cover-all.claude.json')
const TRUST_NOTE = 'Claude Code installs on next start, once you trust the folder'

const pluginsBlock = (...entries: string[]) => `plugins:\n${entries.join('\n')}\n`
const localPlugin = (name: string, path: string) =>
  `  - name: ${name}\n    source: {type: local, path: ${JSON.stringify(path)}}`
const claudeConfig = (plugins: string, sync?: SyncConfigOptions, assistants = ['claude-code']) =>
  buildConfigYaml({assistants, ...(sync ? {sync} : {})}) + plugins

/** A plugin with one always-on rule, which Claude Code receives as a rule file outside the plugin. */
const rulePlugin = (version: string, rule: string) => ({
  'plugin.json': pluginManifest('hello', version),
  skills: {hello: {'SKILL.md': '---\nname: hello\ndescription: Say hello.\n---\n\nHello\n'}},
  'dev.crucibledx.forge': {rules: {'style.md': `${rule}\n`}},
})

/** Every file under root with its text, keyed by its `/` path relative to root. */
async function tree(root: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {}
  for (const entry of await readdir(root, {recursive: true, withFileTypes: true}))
    if (entry.isFile()) {
      const path = join(entry.parentPath, entry.name)
      files[relative(root, path).replaceAll('\\', '/')] = await readFile(path, 'utf8')
    }
  return files
}

/** Content and POSIX mode of every file under root, for a full before/after comparison. */
async function snapshot(root: string): Promise<Record<string, {content: string; mode: number}>> {
  const files: Record<string, {content: string; mode: number}> = {}
  for (const [path, content] of Object.entries(await tree(root)))
    files[path] = {content, mode: (await stat(join(root, path))).mode & 0o777}
  return files
}

/** A passive node for PATH fixtures: the Droid rules hook needs it at run time; sync never spawns it. */
const writeNodeShim = async (dir: string) => {
  await mkdir(dir, {recursive: true})
  if (process.platform === 'win32') await writeFile(join(dir, 'node.cmd'), '@exit /b 0\r\n')
  else {
    await writeFile(join(dir, 'node'), '#!/bin/sh\nexit 0\n')
    await chmod(join(dir, 'node'), 0o755)
  }
}

describe('forge sync — Claude Code plugin delivery', () => {
  it('installs cover-all in project scope: plan, settings keys, rule files, tree, catalogs, lock and report (AC-7, AC-8, AC-10, AC-16, AC-17)', async () => {
    const dir = getDir()
    const proj = join(dir, 'proj')
    const shim = join(dir, 'bin')
    const marker = join(dir, 'spawned')
    await mkdir(shim, {recursive: true})
    for (const cli of ['claude', 'droid']) {
      await writeFile(join(shim, cli), '#!/bin/sh\necho called >> "$FORGE_SPAWN_MARKER"\n')
      await chmod(join(shim, cli), 0o755)
    }
    await writeConfig(proj, claudeConfig(pluginsBlock(localPlugin('cover-all', COVER_ALL_DIR))))
    const env = {PATH: [shim, '/usr/bin', '/bin'].join(delimiter), FORGE_SPAWN_MARKER: marker}

    // The plan lists the rule files and notes the folder-trust requirement, and writes nothing.
    const plan = await runCommand(proj, 'sync', ['--dry-run'], env)
    expect(plan.exitCode).toBe(0)
    expect(plan.output).toContain('.claude/rules/cover-all--api.md')
    expect(plan.output).toContain(TRUST_NOTE)
    expect(existsSync(join(proj, '.claude'))).toBe(false)

    const {exitCode, output} = await runCommand(proj, 'sync', [], env)
    expect(exitCode).toBe(0)
    // Registrars are file-only: no harness CLI runs.
    expect(existsSync(marker)).toBe(false)

    const root = await realpath(proj)
    const settings = await readJson(join(proj, '.claude/settings.local.json'))
    const [marketplace] = Object.keys(settings.extraKnownMarketplaces ?? {})
    expect(marketplace).toMatch(/^crucible-forge-[a-f0-9]{12}$/)
    expect(settings.extraKnownMarketplaces[marketplace]).toEqual({
      source: {source: 'directory', path: join(root, '.crucible', 'plugins')},
    })
    expect(settings.enabledPlugins).toEqual({[`cover-all@${marketplace}`]: true})
    expect(existsSync(join(proj, '.claude/settings.json'))).toBe(false)

    // Rules land as forge-owned rule files, paths frontmatter kept; the emitted tree is the golden output.
    const golden = await Bun.file(COVER_ALL_CLAUDE).json()
    expect(await tree(join(proj, '.claude/rules'))).toEqual(golden.claudeRules)
    const cache = join(proj, '.crucible', 'plugins')
    expect(await tree(join(cache, 'cover-all/1.0.0/claude-code'))).toEqual(golden.plugin)

    expect(await readFile(join(cache, '.gitignore'), 'utf8')).toBe('*\n')
    const claudeCatalog = await readJson(join(cache, '.claude-plugin/marketplace.json'))
    expect(claudeCatalog).toMatchObject({name: marketplace})
    expect(claudeCatalog.plugins).toEqual([
      {name: 'cover-all', version: '1.0.0', source: './cover-all/1.0.0/claude-code'},
    ])
    expect((await readJson(join(cache, '.factory-plugin/marketplace.json'))).plugins).toEqual([])

    const lock = await readJson(join(proj, '.crucible/forge.lock'))
    expect(Object.keys(lock.plugins[0].outputs)).toEqual(['claude-code'])
    expect(lock.plugins[0].outputs['claude-code']).toMatch(/^[a-f0-9]{64}$/)

    expect(output).toContain(`Plugins (project scope, marketplace ${marketplace})`)
    expect(output).toContain(`Claude Code: installed as cover-all@${marketplace}`)
    expect(output).toContain(TRUST_NOTE)
    expect(output).toContain('adapted rule api: rule file .claude/rules/cover-all--api.md (paths frontmatter kept)')
    expect(output).toContain('adapted rule style: rule file .claude/rules/cover-all--style.md')
    expect(output).toContain('dropped setting setting: plugin default settings are not applied in v0.8')
    const lines = output.trim().split('\n')
    expect(lines[lines.length - 2]).toBe('  Variants:')
    expect(lines[lines.length - 1]).toMatch(/^ {4}claude-code: sha256:[a-f0-9]{64}$/)
    expect(lines[lines.length - 1]).toContain(lock.variants['claude-code'])
  })

  it('delivers each harness its own tree and relocks a rule-text-only change for both (AC-4, AC-5, AC-16)', async () => {
    const dir = getDir()
    const proj = join(dir, 'proj')
    const plugin = join(dir, 'plugin')
    const bin = join(dir, 'bin')
    await writeNodeShim(bin)
    const env = {PATH: [bin, process.env.PATH ?? ''].join(delimiter)}
    await writeSourceTree(plugin, rulePlugin('1.0.0', 'Be brief.'))
    await writeConfig(
      proj,
      claudeConfig(pluginsBlock(localPlugin('hello', plugin)), undefined, ['claude-code', 'droid']),
    )
    expect((await runCommand(proj, 'sync', [], env)).exitCode).toBe(0)

    const cache = join(proj, '.crucible/plugins')
    expect((await readJson(join(cache, '.claude-plugin/marketplace.json'))).plugins).toEqual([
      {name: 'hello', version: '1.0.0', source: './hello/1.0.0/claude-code'},
    ])
    expect((await readJson(join(cache, '.factory-plugin/marketplace.json'))).plugins).toEqual([
      {name: 'hello', version: '1.0.0', source: './hello/1.0.0/droid'},
    ])
    // Claude Code reads the rule from its rules directory; Droid from the generated hook in its tree.
    expect(await readFile(join(proj, '.claude/rules/hello--style.md'), 'utf8')).toBe('Be brief.\n')
    expect(existsSync(join(cache, 'hello/1.0.0/claude-code/forge'))).toBe(false)
    expect(existsSync(join(cache, 'hello/1.0.0/droid/forge/rules.md'))).toBe(true)
    const first = await readJson(join(proj, '.crucible/forge.lock'))

    await writeSourceTree(plugin, rulePlugin('1.0.0', 'Be very brief.'))
    const second = await runCommand(proj, 'sync', [], env)
    expect(second.exitCode).toBe(0)
    expect(second.output).toContain('hello 1.0.0: relocked (local content changed)')
    expect(await readFile(join(proj, '.claude/rules/hello--style.md'), 'utf8')).toBe('Be very brief.\n')
    const relocked = await readJson(join(proj, '.crucible/forge.lock'))
    expect(relocked.plugins[0].outputs['claude-code']).not.toBe(first.plugins[0].outputs['claude-code'])
    expect(relocked.variants['claude-code']).not.toBe(first.variants['claude-code'])
    expect(relocked.variants.droid).not.toBe(first.variants.droid)
  })

  it('installs the locked commit into the Claude Code tree after the source branch moves (AC-3)', async () => {
    const dir = getDir()
    const proj = join(dir, 'proj')
    const repo = await createBareRepo(dir, HELLO_PLUGIN_V1)
    await writeConfig(
      proj,
      claudeConfig(
        pluginsBlock(
          `  - name: hello\n    source: {type: git, url: ${JSON.stringify(repo)}, path: plugins/hello, ref: main}`,
        ),
      ),
    )
    expect((await runSync(proj)).exitCode).toBe(0)
    const sha = await bareRepoCommit(dir, repo, 'main')

    await setBareRepoRef(dir, repo, 'refs/heads/main', HELLO_PLUGIN_V2)
    const second = await runSync(proj)
    expect(second.output).toContain('hello 1.0.0: installed from the lock')
    const skill = join(proj, '.crucible/plugins/hello/1.0.0/claude-code/skills/hello/SKILL.md')
    expect(await readFile(skill, 'utf8')).toContain('Hello v1')
    expect((await readJson(join(proj, '.crucible/forge.lock'))).plugins[0].resolved).toBe(sha)
  }, 15_000)

  it('aborts before writing any Claude Code file on a failing plugin or a missing local path (AC-4, AC-6)', async () => {
    const dir = getDir()
    const proj = join(dir, 'proj')
    const plugin = join(dir, 'plugin')
    await writeSourceTree(plugin, {'plugin.json': pluginManifest('hello', 'not-a-version')})
    for (const path of [plugin, join(dir, 'missing')]) {
      await writeConfig(proj, claudeConfig(pluginsBlock(localPlugin('hello', path))))
      const {exitCode, output} = await runSync(proj)
      expect(exitCode).toBe(1)
      expect(output).toContain('hello')
      expect(existsSync(join(proj, '.claude'))).toBe(false)
      expect(existsSync(join(proj, '.crucible/forge.lock'))).toBe(false)
    }
  })

  it('keeps marketplace identities distinct across the user scope and two projects (AC-10, AC-24)', async () => {
    const dir = getDir()
    const home = join(dir, 'home')
    const projA = join(dir, 'a')
    const projB = join(dir, 'b')
    const plugin = join(dir, 'plugin')
    await writeSourceTree(plugin, rulePlugin('1.0.0', 'Be brief.'))
    for (const root of [home, projA, projB])
      await writeConfig(root, claudeConfig(pluginsBlock(localPlugin('hello', plugin))))

    expect((await runSync(projA)).exitCode).toBe(0)
    expect((await runSync(projB)).exitCode).toBe(0)
    const global = await runCommand(projA, '--global', ['sync'], {HOME: home})
    expect(global.exitCode).toBe(0)
    expect(global.output).toContain('Plugins (user scope, marketplace crucible-forge-user)')

    const userSettings = await readJson(join(home, '.claude/settings.json'))
    expect(existsSync(join(home, '.claude/settings.local.json'))).toBe(false)
    expect(userSettings.extraKnownMarketplaces).toEqual({
      'crucible-forge-user': {
        source: {source: 'directory', path: join(await realpath(home), '.crucible/forge/plugins')},
      },
    })
    expect(userSettings.enabledPlugins).toEqual({'hello@crucible-forge-user': true})
    expect(await readFile(join(home, '.claude/rules/hello--style.md'), 'utf8')).toBe('Be brief.\n')
    const userCatalog = await readJson(join(home, '.crucible/forge/plugins/.claude-plugin/marketplace.json'))
    expect(userCatalog).toMatchObject({name: 'crucible-forge-user'})
    expect(userCatalog.plugins).toEqual([{name: 'hello', version: '1.0.0', source: './hello/1.0.0/claude-code'}])

    const marketplaces: string[] = []
    for (const root of [projA, projB]) {
      const settings = await readJson(join(root, '.claude/settings.local.json'))
      const [marketplace] = Object.keys(settings.extraKnownMarketplaces)
      marketplaces.push(marketplace)
      expect(settings.enabledPlugins).toEqual({[`hello@${marketplace}`]: true})
      expect((await readJson(join(root, '.crucible/plugins/.claude-plugin/marketplace.json'))).name).toBe(marketplace)
    }
    expect(new Set([...marketplaces, 'crucible-forge-user']).size).toBe(3)

    const settingsB = await readFile(join(projB, '.claude/settings.local.json'), 'utf8')
    const settingsHome = await readFile(join(home, '.claude/settings.json'), 'utf8')
    await writeConfig(projA, claudeConfig(''))
    expect((await runSync(projA)).exitCode).toBe(0)
    expect(await readFile(join(projA, '.claude/settings.local.json'), 'utf8')).not.toContain('crucible-forge')
    expect(await readFile(join(projB, '.claude/settings.local.json'), 'utf8')).toBe(settingsB)
    expect(await readFile(join(home, '.claude/settings.json'), 'utf8')).toBe(settingsHome)
  })
})

describe('removing a Claude Code plugin (AC-13)', () => {
  const SIBLINGS = {model: 'sonnet', enabledPlugins: {'other@other-marketplace': true}}

  async function install(dir: string, keepLocal: boolean) {
    await writeSourceTree(join(dir, 'plugin'), rulePlugin('1.0.0', 'Be brief.'))
    await mkdir(join(dir, '.claude'), {recursive: true})
    await writeFile(join(dir, '.claude/settings.local.json'), JSON.stringify(SIBLINGS, null, 2) + '\n')
    await writeConfig(
      dir,
      claudeConfig(pluginsBlock(localPlugin('hello', join(dir, 'plugin'))), {keep_local: keepLocal}),
    )
    expect((await runSync(dir)).exitCode).toBe(0)
    expect(existsSync(join(dir, '.claude/rules/hello--style.md'))).toBe(true)
  }

  for (const keepLocal of [false, true])
    it(`sync with keep_local ${keepLocal} removes the keys and ${keepLocal ? 'keeps' : 'deletes'} the rule file`, async () => {
      const dir = getDir()
      await install(dir, keepLocal)
      await writeConfig(dir, claudeConfig('', {keep_local: keepLocal}))
      const {exitCode, output} = await runSync(dir)
      expect(exitCode).toBe(0)
      expect(output).toContain('hello: removed')
      expect(await readJson(join(dir, '.claude/settings.local.json'))).toEqual(SIBLINGS)
      expect(existsSync(join(dir, '.claude/rules/hello--style.md'))).toBe(keepLocal)
      expect(existsSync(join(dir, '.crucible/plugins/hello'))).toBe(false)
    })

  it(
    'forge uninstall deletes the rule file even with keep_local true',
    async () => {
      const dir = getDir()
      await install(dir, true)
      await runUninstallSession(dir, (cli) =>
        cli.waitForText('Continue?').pressKey(Y).waitForText(UNINSTALL_MESSAGES.done),
      )
      expect(existsSync(join(dir, '.claude/rules/hello--style.md'))).toBe(false)
      expect(await readJson(join(dir, '.claude/settings.local.json'))).toEqual(SIBLINGS)
      expect(existsSync(join(dir, '.crucible'))).toBe(false)
    },
    TIMEOUT_MS,
  )
})

describe('AC-14 rollback of a Claude Code plugin sync', () => {
  it.skipIf(process.platform === 'win32')(
    'restores the settings file and removes the rule file when a late commit step fails',
    async () => {
      const dir = getDir()
      const proj = join(dir, 'proj')
      const plugin = join(dir, 'plugin')
      await writeSourceTree(plugin, rulePlugin('1.0.0', 'Be brief.'))
      await writeConfig(proj, claudeConfig(pluginsBlock(localPlugin('hello', plugin))))
      await mkdir(join(proj, '.claude'), {recursive: true})
      await writeFile(join(proj, '.claude/settings.local.json'), '{\n  "model": "sonnet"\n}\n')
      const before = await snapshot(proj)

      const result = await runCommand(proj, 'sync', [], {FORGE_TEST_FAIL_COMMIT: '.crucible/sync-state.json'})
      expect(result.exitCode).toBe(1)
      expect(result.output).toMatch(/after replacing:[^\n]*\.claude\/rules\/hello--style\.md/)
      expect(result.output).toMatch(/after replacing:[^\n]*\.claude\/settings\.local\.json/)
      expect(result.output).toContain('Rollback complete')
      expect(await snapshot(proj)).toEqual(before)
    },
  )
})
