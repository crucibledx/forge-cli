/**
 * E2E tests for plugin delivery in `forge sync` (spec 0003 §4–§5), Droid side.
 *
 * Covers the sync halves of AC-3/AC-4, AC-6, AC-7, AC-9, AC-16, AC-17, AC-18 and AC-24.
 */

import {existsSync} from 'node:fs'
import {chmod, mkdir, readFile, realpath, rename, rm, stat, writeFile} from 'node:fs/promises'
import {delimiter, join} from 'node:path'

import {describe, expect, it} from 'bun:test'

import {buildConfigYaml, writeConfig, writeSourceTree} from '@e2e/fixtures'
import {COVER_ALL_DIR, HELLO_PLUGIN_V1, HELLO_PLUGIN_V2, pluginManifest} from '@e2e/fixtures/plugin-packages'
import {bareRepoCommit, createBareRepo, runCommand, runSync, setBareRepoRef, useTmpDir} from '@e2e/framework'

const getDir = useTmpDir('forge-sync-plugins')

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const readJson = async (path: string): Promise<any> => JSON.parse(await readFile(path, 'utf8'))

const pluginsBlock = (...entries: string[]) => `plugins:\n${entries.join('\n')}\n`
const localPlugin = (path: string, extra = '') =>
  `  - name: hello\n    source: {type: local, path: ${JSON.stringify(path)}}${extra}`

const miniPlugin = (version: string, body: string) => ({
  'plugin.json': pluginManifest('hello', version),
  skills: {hello: {'SKILL.md': `---\nname: hello\ndescription: Say hello.\n---\n\n${body}\n`}},
})

/** A passive, platform-appropriate node executable for PATH fixtures; sync itself must never spawn it. */
const writeNodeShim = async (dir: string) => {
  if (process.platform === 'win32') await writeFile(join(dir, 'node.cmd'), '@exit /b 0\r\n')
  else {
    await writeFile(join(dir, 'node'), '#!/bin/sh\nexit 0\n')
    await chmod(join(dir, 'node'), 0o755)
  }
}

/** A 'node' PATH entry that exists but cannot run, shadowing any real node later on PATH (first match wins). */
const writeBlockedNodeShim = async (dir: string) => {
  if (process.platform === 'win32') await mkdir(join(dir, 'node.exe'), {recursive: true})
  else await writeFile(join(dir, 'node'), '#!/bin/sh\nexit 0\n', {mode: 0o644})
}

describe('forge sync — Droid plugin delivery', () => {
  it('installs a plugin in project scope: settings keys, catalogs, cache, lock and report (AC-9, AC-16, AC-17)', async () => {
    const dir = getDir()
    const proj = join(dir, 'proj')
    const shim = join(dir, 'bin')
    const marker = join(dir, 'spawned')
    await mkdir(shim, {recursive: true})
    for (const cli of ['droid', 'claude']) {
      await writeFile(join(shim, cli), '#!/bin/sh\necho called >> "$FORGE_SPAWN_MARKER"\n')
      await chmod(join(shim, cli), 0o755)
    }
    // Passive node: the generated rules hook needs node on PATH, but sync itself must never spawn it.
    await writeNodeShim(shim)
    await writeSourceTree(join(dir, 'src'), {skills: {'deploy.md': '# Deploy'}})
    await writeConfig(
      proj,
      buildConfigYaml({assistants: ['droid'], localSource: {path: join(dir, 'src')}}) +
        pluginsBlock(`  - name: cover-all\n    source: {type: local, path: ${JSON.stringify(COVER_ALL_DIR)}}`),
    )

    const {exitCode, output} = await runCommand(proj, 'sync', [], {
      PATH: [shim, '/usr/bin', '/bin'].join(delimiter),
      FORGE_SPAWN_MARKER: marker,
    })
    expect(exitCode).toBe(0)
    // Registrars are file-only: no harness CLI runs.
    expect(existsSync(marker)).toBe(false)

    const root = await realpath(proj)
    const settings = await readJson(join(proj, '.factory/settings.local.json'))
    const [marketplace] = Object.keys(settings.extraKnownMarketplaces ?? {})
    expect(marketplace).toMatch(/^crucible-forge-[a-f0-9]{12}$/)
    expect(settings.extraKnownMarketplaces[marketplace]).toEqual({
      source: {source: 'local', path: join(root, '.crucible', 'plugins')},
    })
    expect(settings.enabledPlugins).toEqual({[`cover-all@${marketplace}`]: true})

    // Each catalog lists exactly what its harness installs; Claude Code gets nothing in this config.
    const cache = join(proj, '.crucible', 'plugins')
    expect(await readFile(join(cache, '.gitignore'), 'utf8')).toBe('*\n')
    const factoryCatalog = await readJson(join(cache, '.factory-plugin/marketplace.json'))
    expect(factoryCatalog).toMatchObject({name: marketplace})
    expect(factoryCatalog.plugins).toEqual([{name: 'cover-all', version: '1.0.0', source: './cover-all/1.0.0/droid'}])
    expect((await readJson(join(cache, '.claude-plugin/marketplace.json'))).plugins).toEqual([])

    // The emitted Droid tree: the canonical layout plus the generated SessionStart rule hook.
    const hooks = await readJson(join(cache, 'cover-all/1.0.0/droid/hooks/hooks.json'))
    expect(hooks.hooks.SessionStart).toHaveLength(2)
    expect(JSON.stringify(hooks.hooks.SessionStart[0])).toContain('echo cover-all ready')
    expect(hooks.hooks.SessionStart[1]).toEqual({
      hooks: [{type: 'command', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/forge/print-rules.cjs']}],
    })
    expect(existsSync(join(cache, 'cover-all/1.0.0/droid/forge/print-rules.cjs'))).toBe(true)
    const rules = await readFile(join(cache, 'cover-all/1.0.0/droid/forge/rules.md'), 'utf8')
    expect(rules).toContain('Validate every request body with a schema.')
    expect(rules).not.toContain('paths:')

    const lock = await readJson(join(proj, '.crucible/forge.lock'))
    expect(lock.plugins[0].name).toBe('cover-all')
    expect(lock.plugins[0].outputs.droid).toMatch(/^[a-f0-9]{64}$/)
    expect(lock.variants.droid).toMatch(/^sha256:[a-f0-9]{64}$/)

    // AC-7 + AC-17: the portability lines and the report ends with the plugin set and the variants.
    expect(output).toContain(`Plugins (project scope, marketplace ${marketplace})`)
    expect(output).toContain('cover-all 1.0.0: resolved and locked')
    expect(output).toContain(`Droid: installed as cover-all@${marketplace}`)
    expect(output).toContain('Droid installs on next start')
    expect(output).toContain('approximated rule api:')
    expect(output).toContain('adapted rule style:')
    expect(output).toContain('dropped lsp lsp:')
    expect(output).toContain('dropped setting setting:')
    expect(output.indexOf('Plugins (project scope')).toBeGreaterThan(output.indexOf('Last sync'))
    const lines = output.trim().split('\n')
    expect(lines[lines.length - 2]).toBe('  Variants:')
    expect(lines[lines.length - 1]).toMatch(/^ {4}droid: sha256:[a-f0-9]{64}$/)
  })

  it('follows the lock discipline for a local source and prunes old cache versions (AC-4, AC-16)', async () => {
    const dir = getDir()
    const proj = join(dir, 'proj')
    const plugin = join(dir, 'plugin')
    await writeSourceTree(plugin, miniPlugin('1.0.0', 'Hello v1'))
    await writeConfig(proj, buildConfigYaml({assistants: ['droid']}) + pluginsBlock(localPlugin(plugin)))

    const first = await runSync(proj)
    expect(first.exitCode).toBe(0)
    expect(first.output).toContain('hello 1.0.0: resolved and locked')
    const locked = await readFile(join(proj, '.crucible/forge.lock'), 'utf8')

    const second = await runSync(proj)
    expect(second.output).toContain('hello 1.0.0: installed from the lock')
    expect(await readFile(join(proj, '.crucible/forge.lock'), 'utf8')).toBe(locked)

    await writeSourceTree(plugin, miniPlugin('1.0.0', 'Hello v2'))
    const third = await runSync(proj)
    expect(third.output).toContain('hello 1.0.0: relocked (local content changed)')
    const relocked = await readJson(join(proj, '.crucible/forge.lock'))
    expect(relocked.plugins[0].contentHash).not.toBe(JSON.parse(locked).plugins[0].contentHash)
    expect(await readFile(join(proj, '.crucible/plugins/hello/1.0.0/droid/skills/hello/SKILL.md'), 'utf8')).toContain(
      'Hello v2',
    )

    await writeSourceTree(plugin, miniPlugin('1.0.1', 'Hello v2'))
    const fourth = await runSync(proj)
    expect(fourth.output).toContain('hello 1.0.1: relocked (local content changed)')
    const cache = join(proj, '.crucible/plugins')
    expect(existsSync(join(cache, 'hello/1.0.0'))).toBe(false)
    expect(existsSync(join(cache, 'hello/1.0.1/droid'))).toBe(true)
    const catalog = await readJson(join(cache, '.factory-plugin/marketplace.json'))
    expect(catalog.plugins).toEqual([{name: 'hello', version: '1.0.1', source: './hello/1.0.1/droid'}])
  })

  it('installs the locked commit even after the source branch moves (AC-3)', async () => {
    const dir = getDir()
    const proj = join(dir, 'proj')
    const repo = await createBareRepo(dir, HELLO_PLUGIN_V1)
    await writeConfig(
      proj,
      buildConfigYaml({assistants: ['droid']}) +
        pluginsBlock(
          `  - name: hello\n    source: {type: git, url: ${JSON.stringify(repo)}, path: plugins/hello, ref: main}`,
        ),
    )

    const first = await runSync(proj)
    expect(first.exitCode).toBe(0)
    const sha = await bareRepoCommit(dir, repo, 'main')
    const lock = await readJson(join(proj, '.crucible/forge.lock'))
    expect(lock.plugins[0]).toMatchObject({name: 'hello', version: '1.0.0', resolved: sha})

    await setBareRepoRef(dir, repo, 'refs/heads/main', HELLO_PLUGIN_V2)
    const second = await runSync(proj)
    expect(second.output).toContain('hello 1.0.0: installed from the lock')
    const cache = join(proj, '.crucible/plugins')
    expect(await readFile(join(cache, 'hello/1.0.0/droid/skills/hello/SKILL.md'), 'utf8')).toContain('Hello v1')
    expect(existsSync(join(cache, 'hello/1.1.0'))).toBe(false)
    const lockAfter = await readJson(join(proj, '.crucible/forge.lock'))
    expect(lockAfter.plugins[0].resolved).toBe(sha)
  }, 15_000)

  it('aborts before any write when a local source path does not exist (AC-4)', async () => {
    const dir = getDir()
    const proj = join(dir, 'proj')
    await writeConfig(proj, buildConfigYaml({assistants: ['droid']}) + pluginsBlock(localPlugin(join(dir, 'missing'))))
    const {exitCode, output} = await runSync(proj)
    expect(exitCode).toBe(1)
    expect(output).toContain('hello')
    expect(output).toContain('does not exist')
    expect(existsSync(join(proj, '.crucible/forge.lock'))).toBe(false)
    expect(existsSync(join(proj, '.factory'))).toBe(false)
  })

  it('aborts before any write when a plugin fails validation (AC-6)', async () => {
    const dir = getDir()
    const proj = join(dir, 'proj')
    const plugin = join(dir, 'plugin')
    await writeSourceTree(plugin, {'plugin.json': pluginManifest('hello', 'not-a-version')})
    await writeConfig(proj, buildConfigYaml({assistants: ['droid']}) + pluginsBlock(localPlugin(plugin)))
    const {exitCode, output} = await runSync(proj)
    expect(exitCode).toBe(1)
    expect(output).toContain('hello')
    expect(existsSync(join(proj, '.crucible/forge.lock'))).toBe(false)
    expect(existsSync(join(proj, '.factory'))).toBe(false)
  })

  it('aborts before any write on a cache miss with an unreachable source (AC-6)', async () => {
    const dir = getDir()
    const proj = join(dir, 'proj')
    const plugin = join(dir, 'plugin')
    await writeSourceTree(plugin, miniPlugin('1.0.0', 'Hello v1'))
    await writeConfig(proj, buildConfigYaml({assistants: ['droid']}) + pluginsBlock(localPlugin(plugin)))
    expect((await runSync(proj)).exitCode).toBe(0)
    const settingsPath = join(proj, '.factory/settings.local.json')
    const settings = await readFile(settingsPath, 'utf8')

    await rm(join(proj, '.crucible/plugins'), {recursive: true})
    await rename(plugin, join(dir, 'plugin-gone'))
    const {exitCode, output} = await runSync(proj)
    expect(exitCode).toBe(1)
    expect(output).toContain('hello')
    expect(await readFile(settingsPath, 'utf8')).toBe(settings)
    expect(existsSync(join(proj, '.crucible/plugins'))).toBe(false)
  })

  it('reports plugins are not supported for a harness without a capability and keeps its loose sync (AC-18)', async () => {
    const dir = getDir()
    const proj = join(dir, 'proj')
    const plugin = join(dir, 'plugin')
    await writeSourceTree(plugin, miniPlugin('1.0.0', 'Hello v1'))
    await writeSourceTree(join(dir, 'src'), {skills: {'deploy.md': '# Deploy'}})
    await writeConfig(
      proj,
      buildConfigYaml({assistants: ['droid', 'cursor'], localSource: {path: join(dir, 'src')}}) +
        pluginsBlock(localPlugin(plugin)),
    )
    const {exitCode, output} = await runSync(proj)
    expect(exitCode).toBe(0)
    expect(output).toContain('plugins are not supported for Cursor yet')
    expect(output).toContain('Droid: installed as hello@')
    expect(await readFile(join(proj, '.cursor/skills/deploy.md'), 'utf8')).toBe('# Deploy')
  })

  it('installs into the user scope with forge sync --global (AC-9, AC-16)', async () => {
    const home = getDir()
    const plugin = join(home, 'plugin')
    await writeSourceTree(plugin, miniPlugin('1.0.0', 'Hello v1'))
    await writeConfig(home, buildConfigYaml({assistants: ['droid']}) + pluginsBlock(localPlugin(plugin)))

    const {exitCode, output} = await runCommand(home, '--global', ['sync'], {HOME: home})
    expect(exitCode).toBe(0)

    const root = await realpath(home)
    const settings = await readJson(join(home, '.factory/settings.json'))
    expect(existsSync(join(home, '.factory/settings.local.json'))).toBe(false)
    expect(settings.extraKnownMarketplaces['crucible-forge-user']).toEqual({
      source: {source: 'local', path: join(root, '.crucible', 'forge', 'plugins')},
    })
    expect(settings.enabledPlugins).toEqual({'hello@crucible-forge-user': true})
    expect(existsSync(join(home, '.crucible/forge/forge.lock'))).toBe(true)
    const catalog = await readJson(join(home, '.crucible/forge/plugins/.factory-plugin/marketplace.json'))
    expect(catalog).toMatchObject({name: 'crucible-forge-user'})
    expect(catalog.plugins).toEqual([{name: 'hello', version: '1.0.0', source: './hello/1.0.0/droid'}])
    expect(output).toContain('Plugins (user scope, marketplace crucible-forge-user)')
  })

  it('rejects a user-scope entry in the project config with a named error (spec 0003 §4)', async () => {
    const dir = getDir()
    const proj = join(dir, 'proj')
    const plugin = join(dir, 'plugin')
    await writeSourceTree(plugin, miniPlugin('1.0.0', 'Hello v1'))
    await writeConfig(
      proj,
      buildConfigYaml({assistants: ['droid']}) + pluginsBlock(localPlugin(plugin, '\n    scope: user')),
    )
    const {exitCode, output} = await runSync(proj)
    expect(exitCode).toBe(1)
    expect(output).toContain('Plugin scope mismatch: "hello"')
    expect(output).toContain('forge sync --global')
    expect(existsSync(join(proj, '.factory'))).toBe(false)
  })

  it('rejects a project-scope entry in the user config with a named error (spec 0003 §4)', async () => {
    const home = getDir()
    const plugin = join(home, 'plugin')
    await writeSourceTree(plugin, miniPlugin('1.0.0', 'Hello v1'))
    await writeConfig(
      home,
      buildConfigYaml({assistants: ['droid']}) + pluginsBlock(localPlugin(plugin, '\n    scope: project')),
    )
    const {exitCode, output} = await runCommand(home, '--global', ['sync'], {HOME: home})
    expect(exitCode).toBe(1)
    expect(output).toContain('Plugin scope mismatch: "hello"')
    expect(output).toContain('forge.config.yaml')
  })

  it('removes the last plugin of a plugin-only config instead of rejecting the empty config (spec 0003 §5)', async () => {
    const dir = getDir()
    const proj = join(dir, 'proj')
    const plugin = join(dir, 'plugin')
    await writeSourceTree(plugin, miniPlugin('1.0.0', 'Hello v1'))
    await writeConfig(proj, buildConfigYaml({assistants: ['droid']}) + pluginsBlock(localPlugin(plugin)))
    expect((await runSync(proj)).exitCode).toBe(0)
    expect(existsSync(join(proj, '.factory/settings.local.json'))).toBe(true)

    await writeConfig(proj, buildConfigYaml({assistants: ['droid']}))
    const {exitCode, output} = await runSync(proj)
    expect(exitCode).toBe(0)
    expect(output).toContain('hello: removed')
    expect(await readFile(join(proj, '.factory/settings.local.json'), 'utf8')).not.toContain('crucible-forge')
    expect(existsSync(join(proj, '.crucible/plugins/hello'))).toBe(false)
    expect(existsSync(join(proj, '.crucible/plugins/.gitignore'))).toBe(false)
    expect(existsSync(join(proj, '.crucible/plugins/.factory-plugin'))).toBe(false)
  })

  it.skipIf(process.platform === 'win32')(
    'repairs the executable bit when only the mode of a cache file changed',
    async () => {
      const dir = getDir()
      const proj = join(dir, 'proj')
      const plugin = join(dir, 'plugin')
      await writeSourceTree(plugin, {
        'plugin.json': pluginManifest('hello', '1.0.0'),
        scripts: {'run.sh': '#!/bin/sh\necho hi\n'},
      })
      await writeConfig(proj, buildConfigYaml({assistants: ['droid']}) + pluginsBlock(localPlugin(plugin)))
      expect((await runSync(proj)).exitCode).toBe(0)
      const cache = join(proj, '.crucible/plugins/hello/1.0.0')
      const mode = async (path: string) => (await stat(path)).mode & 0o111
      expect(await mode(join(cache, 'droid/scripts/run.sh'))).toBe(0)

      await chmod(join(plugin, 'scripts/run.sh'), 0o755)
      expect((await runSync(proj)).exitCode).toBe(0)
      expect(await mode(join(cache, 'droid/scripts/run.sh'))).not.toBe(0)
      expect(await mode(join(cache, 'source/scripts/run.sh'))).not.toBe(0)

      await chmod(join(plugin, 'scripts/run.sh'), 0o644)
      expect((await runSync(proj)).exitCode).toBe(0)
      expect(await mode(join(cache, 'droid/scripts/run.sh'))).toBe(0)
      expect(await mode(join(cache, 'source/scripts/run.sh'))).toBe(0)
    },
  )

  it('keeps the delivered tree, catalog entry and lock outputs of a disabled harness whose keys are retained', async () => {
    const dir = getDir()
    const proj = join(dir, 'proj')
    const plugin = join(dir, 'plugin')
    await writeSourceTree(plugin, miniPlugin('1.0.0', 'Hello v1'))
    await writeSourceTree(join(dir, 'src'), {skills: {'a.md': '# A'}})
    await writeConfig(
      proj,
      buildConfigYaml({assistants: ['droid'], localSource: {path: join(dir, 'src')}}) +
        pluginsBlock(localPlugin(plugin)),
    )
    expect((await runSync(proj)).exitCode).toBe(0)

    // Disable Droid but keep its registration: Cursor is enabled (no plugin capability), so the
    // Droid settings keys are retained and its delivered files must stay exactly as installed.
    await writeConfig(
      proj,
      buildConfigYaml({assistants: ['cursor'], localSource: {path: join(dir, 'src')}}) +
        pluginsBlock(localPlugin(plugin)),
    )
    const {exitCode} = await runSync(proj)
    expect(exitCode).toBe(0)
    const settings = await readFile(join(proj, '.factory/settings.local.json'), 'utf8')
    expect(settings).toContain('crucible-forge')
    const lock = await readJson(join(proj, '.crucible/forge.lock'))
    expect(lock.plugins[0].outputs.droid).toMatch(/^[a-f0-9]{64}$/)
    const catalog = await readJson(join(proj, '.crucible/plugins/.factory-plugin/marketplace.json'))
    expect(catalog.plugins).toEqual([{name: 'hello', version: '1.0.0', source: './hello/1.0.0/droid'}])
    expect(existsSync(join(proj, '.crucible/plugins/hello/1.0.0/droid/skills/hello/SKILL.md'))).toBe(true)

    // Removing the plugin while Droid is still disabled keeps the retained tree, catalog entry and keys:
    // the registration is cleaned up only once Droid is enabled again.
    await writeConfig(proj, buildConfigYaml({assistants: ['cursor'], localSource: {path: join(dir, 'src')}}))
    expect((await runSync(proj)).exitCode).toBe(0)
    expect(await readFile(join(proj, '.factory/settings.local.json'), 'utf8')).toContain('crucible-forge')
    expect((await readJson(join(proj, '.crucible/plugins/.factory-plugin/marketplace.json'))).plugins).toEqual([
      {name: 'hello', version: '1.0.0', source: './hello/1.0.0/droid'},
    ])
    expect(existsSync(join(proj, '.crucible/plugins/hello/1.0.0/droid/skills/hello/SKILL.md'))).toBe(true)

    // Re-enabling Droid finally cleans the registration up: keys, catalog and tree.
    await writeConfig(proj, buildConfigYaml({assistants: ['droid'], localSource: {path: join(dir, 'src')}}))
    expect((await runSync(proj)).exitCode).toBe(0)
    expect(await readFile(join(proj, '.factory/settings.local.json'), 'utf8')).not.toContain('crucible-forge')
    expect(existsSync(join(proj, '.crucible/plugins/.factory-plugin/marketplace.json'))).toBe(false)
    expect(existsSync(join(proj, '.crucible/plugins/hello'))).toBe(false)
  })

  it('reports an explicitly targeted disabled harness as not enabled instead of installing it', async () => {
    const dir = getDir()
    const proj = join(dir, 'proj')
    const plugin = join(dir, 'plugin')
    await writeSourceTree(plugin, miniPlugin('1.0.0', 'Hello v1'))
    await writeSourceTree(join(dir, 'src'), {skills: {'a.md': '# A'}})
    await writeConfig(
      proj,
      buildConfigYaml({assistants: ['cursor'], localSource: {path: join(dir, 'src')}}) +
        pluginsBlock(localPlugin(plugin, '\n    harnesses: [droid]')),
    )
    const {exitCode, output} = await runSync(proj)
    expect(exitCode).toBe(0)
    expect(output).toContain('not enabled in this config; not delivered to Droid')
    expect(output).not.toContain('Droid: installed')
    const lock = await readJson(join(proj, '.crucible/forge.lock'))
    expect(lock.plugins[0].outputs).toEqual({})
    const catalog = await readJson(join(proj, '.crucible/plugins/.factory-plugin/marketplace.json'))
    expect(catalog.plugins).toEqual([])
    expect(existsSync(join(proj, '.crucible/plugins/hello/1.0.0/droid'))).toBe(false)
  })

  it('fails with an actionable error when a rules plugin needs node for its Droid hook and node is not on PATH', async () => {
    const dir = getDir()
    const proj = join(dir, 'proj')
    const shim = join(dir, 'bin')
    const plugin = join(dir, 'plugin')
    await writeSourceTree(plugin, {
      'plugin.json': pluginManifest('hello', '1.0.0'),
      'dev.crucibledx.forge': {rules: {'style.md': 'Be brief.\n'}},
    })
    await writeConfig(proj, buildConfigYaml({assistants: ['droid']}) + pluginsBlock(localPlugin(plugin)))

    // A shadowing non-runnable 'node' entry keeps the machine's real node unreachable without relying on
    // where the machine keeps it, and leaves the system directories the test framework itself needs on PATH.
    const blockedDir = join(dir, 'blocked')
    await mkdir(blockedDir, {recursive: true})
    await writeBlockedNodeShim(blockedDir)
    const basePath = ['/usr/bin', '/bin'].join(delimiter)
    const blocked = await runCommand(proj, 'sync', [], {PATH: [blockedDir, basePath].join(delimiter)})
    expect(blocked.exitCode).toBe(1)
    expect(blocked.output).toContain('node')
    expect(blocked.output).toContain('hello')
    expect(existsSync(join(proj, '.crucible/plugins'))).toBe(false)

    await mkdir(shim, {recursive: true})
    await writeNodeShim(shim)
    const allowed = await runCommand(proj, 'sync', [], {PATH: [shim, basePath].join(delimiter)})
    expect(allowed.exitCode).toBe(0)
    expect(existsSync(join(proj, '.crucible/plugins/hello/1.0.0/droid/forge/print-rules.cjs'))).toBe(true)
  })

  it('keeps marketplace identities distinct across scopes and projects (AC-24)', async () => {
    const dir = getDir()
    const home = join(dir, 'home')
    const projA = join(dir, 'a')
    const projB = join(dir, 'b')
    const plugin = join(dir, 'plugin')
    await writeSourceTree(plugin, miniPlugin('1.0.0', 'Hello v1'))
    const configure = async (root: string) => {
      const src = join(root, 'src')
      await writeSourceTree(src, {skills: {'a.md': '# A'}})
      await writeConfig(
        root,
        buildConfigYaml({assistants: ['droid'], localSource: {path: src}}) + pluginsBlock(localPlugin(plugin)),
      )
    }
    await configure(home)
    await configure(projA)
    await configure(projB)

    expect((await runSync(projA)).exitCode).toBe(0)
    expect((await runSync(projB)).exitCode).toBe(0)
    expect((await runCommand(projA, '--global', ['sync'], {HOME: home})).exitCode).toBe(0)

    const settingsA = await readFile(join(projA, '.factory/settings.local.json'), 'utf8')
    const settingsB = await readFile(join(projB, '.factory/settings.local.json'), 'utf8')
    const settingsHome = await readFile(join(home, '.factory/settings.json'), 'utf8')
    const marketplaceOf = (text: string) => Object.keys(JSON.parse(text).extraKnownMarketplaces ?? {})[0]
    const [mA, mB, mH] = [marketplaceOf(settingsA), marketplaceOf(settingsB), marketplaceOf(settingsHome)]
    expect(mH).toBe('crucible-forge-user')
    expect(new Set([mA, mB, mH]).size).toBe(3)

    // Every enabled plugin ID resolves against the catalog in the same cache root.
    for (const [root, marketplace] of [
      [projA, mA],
      [projB, mB],
    ] as const) {
      const catalog = await readJson(join(root, '.crucible/plugins/.factory-plugin/marketplace.json'))
      expect(catalog.name).toBe(marketplace)
      expect(catalog.plugins.map((item: {name: string}) => item.name)).toContain('hello')
      expect(JSON.parse(await readFile(join(root, '.factory/settings.local.json'), 'utf8')).enabledPlugins).toEqual({
        [`hello@${marketplace}`]: true,
      })
    }
    const homeCatalog = await readJson(join(home, '.crucible/forge/plugins/.factory-plugin/marketplace.json'))
    expect(homeCatalog.name).toBe('crucible-forge-user')

    // Removing one project's plugin leaves the other project's and the user scope's keys untouched.
    await writeConfig(projA, buildConfigYaml({assistants: ['droid'], localSource: {path: join(projA, 'src')}}))
    expect((await runSync(projA)).exitCode).toBe(0)
    expect(await readFile(join(projA, '.factory/settings.local.json'), 'utf8')).not.toContain('crucible-forge')
    expect(await readFile(join(projB, '.factory/settings.local.json'), 'utf8')).toBe(settingsB)
    expect(await readFile(join(home, '.factory/settings.json'), 'utf8')).toBe(settingsHome)
  })
})
