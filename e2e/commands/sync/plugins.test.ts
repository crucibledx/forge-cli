/**
 * E2E tests for plugin delivery in `forge sync` (spec 0003 §4–§5), Droid side.
 *
 * Covers the sync halves of AC-3/AC-4, AC-6, AC-7, AC-9, AC-16, AC-17, AC-18 and AC-24.
 */

import {existsSync} from 'node:fs'
import {chmod, mkdir, readFile, realpath, rename, rm, stat, symlink, writeFile} from 'node:fs/promises'
import {delimiter, join} from 'node:path'

import {describe, expect, it} from 'bun:test'

import {buildConfigYaml, writeConfig, writeSourceTree} from '@e2e/fixtures'
import {COVER_ALL_DIR, HELLO_PLUGIN_V1, HELLO_PLUGIN_V2, pluginManifest} from '@e2e/fixtures/plugin-packages'
import {
  bareRepoCommit,
  createBareRepo,
  runCommand,
  runSync,
  runUninstallSession,
  setBareRepoRef,
  UNINSTALL_MESSAGES,
  useTmpDir,
  Y,
} from '@e2e/framework'

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

/**
 * A PATH containing only what the test plants, so "node absent" or "node present" is true regardless
 * of the machine. POSIX also plants the ps the framework's cleanup probe spawns (framework/process.ts),
 * resolved from the test's own PATH; Windows cleanup uses job objects and needs nothing. Verified:
 * `bun run <file>` adds no node shim to the child's PATH, so nothing reintroduces node.
 */
const writePathFixture = async (dir: string, {node}: {node: boolean}) => {
  await mkdir(dir, {recursive: true})
  if (node) await writeNodeShim(dir)
  if (process.platform !== 'win32') {
    const ps = Bun.which('ps')
    if (ps === null) throw new Error('ps is not on the test PATH; the framework cleanup probe needs it')
    await symlink(ps, join(dir, 'ps'))
  }
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
    const plugin = join(dir, 'plugin')
    await writeSourceTree(plugin, {
      'plugin.json': pluginManifest('hello', '1.0.0'),
      'dev.crucibledx.forge': {rules: {'style.md': 'Be brief.\n'}},
    })
    await writeConfig(proj, buildConfigYaml({assistants: ['droid']}) + pluginsBlock(localPlugin(plugin)))

    // Synthetic PATHs holding only what this test plants: node is genuinely absent in the blocked
    // case and present in the allowed case, whatever the machine's real PATH looks like.
    const blockedDir = join(dir, 'blocked-path')
    await writePathFixture(blockedDir, {node: false})
    const blocked = await runCommand(proj, 'sync', [], {PATH: blockedDir})
    expect(blocked.exitCode).toBe(1)
    expect(blocked.output).toContain('node')
    expect(blocked.output).toContain('hello')
    expect(existsSync(join(proj, '.crucible/plugins'))).toBe(false)

    const allowedDir = join(dir, 'allowed-path')
    await writePathFixture(allowedDir, {node: true})
    const allowed = await runCommand(proj, 'sync', [], {PATH: allowedDir})
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

describe('forge sync — compile (spec 0005 §1, §2, §5)', () => {
  const setup = async (dir: string, extraConfig = '') => {
    const proj = join(dir, 'proj')
    const plugin = join(dir, 'plugin')
    await writeSourceTree(plugin, miniPlugin('1.0.0', 'Hello v1'))
    const src = join(dir, 'src')
    await writeSourceTree(src, {skills: {'a.md': '# A'}})
    await writeConfig(
      proj,
      buildConfigYaml({assistants: ['droid'], localSource: {path: src}}) +
        pluginsBlock(localPlugin(plugin)) +
        extraConfig,
    )
    return {proj, plugin}
  }

  it('AC-1 compiles as the identity: v0.8 bytes, a manifest and compile lock entries', async () => {
    const dir = getDir()
    const {proj, plugin} = await setup(dir)
    expect((await runSync(proj)).exitCode).toBe(0)

    // The compile manifest: schema 1, every component listed, the lock's variant, no timestamps.
    const manifestDir = join(proj, '.crucible', 'compile')
    expect(await readFile(join(manifestDir, '.gitignore'), 'utf8')).toBe('*\n')
    const manifest = await readJson(join(manifestDir, 'droid.json'))
    const lock = await readJson(join(proj, '.crucible', 'forge.lock'))
    expect(manifest).toMatchObject({schema: 1, harness: 'droid', scope: 'project', enabled: true, compiler: 1})
    expect(manifest.variant).toBe(lock.variants.droid)
    expect(manifest.inputs).toBe(lock.compile.droid.inputs)
    expect(manifest.components.length).toBeGreaterThan(0)
    expect(manifest.components.every((row: {status: string}) => row.status === 'listed')).toBe(true)

    // Lock v2 with fresh compile entries; the identity compile stamps no emitted version.
    expect(lock.version).toBe(2)
    expect(lock.compile.droid).toMatchObject({enabled: true, compiler: 1})
    expect(lock.compile.droid.inputs).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(lock.plugins[0].emitted).toBeUndefined()

    // Byte-identity with v0.8: the delivered tree is the source bytes, the version unstamped.
    const tree = join(proj, '.crucible', 'plugins', 'hello', '1.0.0', 'droid')
    expect((await readJson(join(tree, '.claude-plugin', 'plugin.json'))).version).toBe('1.0.0')
    expect(await readFile(join(tree, 'skills', 'hello', 'SKILL.md'), 'utf8')).toBe(
      await readFile(join(plugin, 'skills', 'hello', 'SKILL.md'), 'utf8'),
    )

    // A second sync is a no-op: no compile lines, no writes.
    const second = await runSync(proj)
    expect(second.exitCode).toBe(0)
    expect(second.output).not.toContain('compiles plugins')
    expect(second.output).not.toContain('recompiled')
  })

  it('shows the v0.8 upgrade line once, then never again', async () => {
    const dir = getDir()
    const {proj} = await setup(dir)
    expect((await runSync(proj)).exitCode).toBe(0)

    const lockPath = join(proj, '.crucible', 'forge.lock')
    const v1 = await readJson(lockPath)
    delete v1.compile
    v1.version = 1
    await writeFile(lockPath, JSON.stringify(v1, null, 2) + '\n')

    const upgraded = await runSync(proj)
    expect(upgraded.exitCode).toBe(0)
    expect(upgraded.output).toContain('forge 0.9 compiles plugins for droid: ')
    expect(upgraded.output).toContain(' listed, 0 deferred')
    expect(upgraded.output).toContain('Set `compile.enabled: false` to keep v0.8 output. See docs/compile.md.')

    const settled = await runSync(proj)
    expect(settled.exitCode).toBe(0)
    expect(settled.output).not.toContain('compiles plugins')
  })

  it('compile.enabled: false keeps the v0.8 output byte for byte and prunes the manifests', async () => {
    const dir = getDir()
    const {proj} = await setup(dir)
    expect((await runSync(proj)).exitCode).toBe(0)
    const compiled = await readFile(
      join(proj, '.crucible', 'plugins', 'hello', '1.0.0', 'droid', '.claude-plugin', 'plugin.json'),
      'utf8',
    )

    const other = join(dir, 'other')
    await writeConfig(
      other,
      buildConfigYaml({assistants: ['droid'], localSource: {path: join(dir, 'src')}}) +
        pluginsBlock(localPlugin(join(dir, 'plugin'))) +
        'compile:\n  enabled: false\n',
    )
    expect((await runSync(other)).exitCode).toBe(0)
    const plain = await readFile(
      join(other, '.crucible', 'plugins', 'hello', '1.0.0', 'droid', '.claude-plugin', 'plugin.json'),
      'utf8',
    )
    expect(plain).toBe(compiled)
    const lock = await readJson(join(other, '.crucible', 'forge.lock'))
    expect(lock.compile.droid).toEqual({enabled: false, compiler: 1})
    expect(existsSync(join(other, '.crucible', 'compile', 'droid.json'))).toBe(false)

    // Disabling in the already-synced project prunes the manifests the enabled sync wrote.
    await writeConfig(
      proj,
      buildConfigYaml({assistants: ['droid'], localSource: {path: join(dir, 'src')}}) +
        pluginsBlock(localPlugin(join(dir, 'plugin'))) +
        'compile:\n  enabled: false\n',
    )
    expect((await runSync(proj)).exitCode).toBe(0)
    expect(existsSync(join(proj, '.crucible', 'compile', 'droid.json'))).toBe(false)
    expect(
      await readFile(
        join(proj, '.crucible', 'plugins', 'hello', '1.0.0', 'droid', '.claude-plugin', 'plugin.json'),
        'utf8',
      ),
    ).toBe(compiled)
  })

  it('names the changed input on the relock line', async () => {
    const dir = getDir()
    const {proj, plugin} = await setup(dir)
    expect((await runSync(proj)).exitCode).toBe(0)
    await writeSourceTree(plugin, miniPlugin('1.0.0', 'Hello v2'))
    const relock = await runSync(proj)
    expect(relock.exitCode).toBe(0)
    expect(relock.output).toContain('recompiled for droid: the plugin set changed')
  })

  it('AC-4 a compile.priority change relocks the inputs while both harnesses keep serving the same bytes', async () => {
    const dir = getDir()
    const proj = join(dir, 'proj')
    const plugin = join(dir, 'plugin')
    await writeSourceTree(plugin, miniPlugin('1.0.0', 'Hello v1'))
    const src = join(dir, 'src')
    await writeSourceTree(src, {skills: {'a.md': '# A'}})
    const config = (extra: string) =>
      buildConfigYaml({assistants: ['droid', 'claude-code'], localSource: {path: src}}) +
      pluginsBlock(localPlugin(plugin)) +
      extra
    await writeConfig(proj, config(''))
    expect((await runSync(proj)).exitCode).toBe(0)
    const lockPath = join(proj, '.crucible', 'forge.lock')
    const before = await readJson(lockPath)
    const served = async () => [
      await readFile(
        join(proj, '.crucible', 'plugins', 'hello', '1.0.0', 'droid', 'skills', 'hello', 'SKILL.md'),
        'utf8',
      ),
      await readFile(
        join(proj, '.crucible', 'plugins', 'hello', '1.0.0', 'claude-code', 'skills', 'hello', 'SKILL.md'),
        'utf8',
      ),
    ]
    const bytesBefore = await served()

    await writeConfig(proj, config('compile:\n  priority:\n    - hello\n'))
    const reprioritised = await runSync(proj)
    expect(reprioritised.exitCode).toBe(0)
    expect(reprioritised.output).toContain('recompiled for droid: the compile config changed')
    expect(reprioritised.output).toContain('recompiled for claude-code: the compile config changed')

    const after = await readJson(lockPath)
    // The priority change moved the config input of both units...
    expect(after.compile.droid.inputs).not.toBe(before.compile.droid.inputs)
    expect(after.compile['claude-code'].inputs).not.toBe(before.compile['claude-code'].inputs)
    // ...while the identity compile kept every byte: both harnesses serve exactly what they served before.
    expect(after.plugins[0].outputs).toEqual(before.plugins[0].outputs)
    expect(after.variants).toEqual(before.variants)
    expect(after.plugins[0].emitted).toBeUndefined()
    expect(await served()).toEqual(bytesBefore)

    const settled = await runSync(proj)
    expect(settled.output).not.toContain('recompiled')
  })

  it('refuses a lock written by a newer compiler before any write (AC-3)', async () => {
    const dir = getDir()
    const {proj} = await setup(dir)
    expect((await runSync(proj)).exitCode).toBe(0)
    const lockPath = join(proj, '.crucible', 'forge.lock')
    const lock = await readJson(lockPath)
    lock.compile.droid = {enabled: true, inputs: lock.compile.droid.inputs, compiler: 99}
    const tampered = JSON.stringify(lock, null, 2) + '\n'
    await writeFile(lockPath, tampered)
    const settings = await readFile(join(proj, '.factory/settings.local.json'), 'utf8')
    const {exitCode, output} = await runSync(proj)
    expect(exitCode).toBe(1)
    expect(output).toContain('upgrade forge')
    expect(await readFile(lockPath, 'utf8')).toBe(tampered)
    expect(await readFile(join(proj, '.factory/settings.local.json'), 'utf8')).toBe(settings)
  })

  it('refuses a lock written by a newer forge before any write (AC-3)', async () => {
    const dir = getDir()
    const {proj} = await setup(dir)
    expect((await runSync(proj)).exitCode).toBe(0)
    const lockPath = join(proj, '.crucible', 'forge.lock')
    const lock = await readJson(lockPath)
    lock.version = 3
    const tampered = JSON.stringify(lock, null, 2) + '\n'
    await writeFile(lockPath, tampered)
    const settings = await readFile(join(proj, '.factory/settings.local.json'), 'utf8')
    const {exitCode, output} = await runSync(proj)
    expect(exitCode).toBe(1)
    expect(output).toContain('upgrade forge')
    expect(await readFile(lockPath, 'utf8')).toBe(tampered)
    expect(await readFile(join(proj, '.factory/settings.local.json'), 'utf8')).toBe(settings)
  })

  it('fails with CompileMismatch before any write when unchanged inputs produce different outputs (AC-3)', async () => {
    const dir = getDir()
    const {proj} = await setup(dir)
    expect((await runSync(proj)).exitCode).toBe(0)
    const lockPath = join(proj, '.crucible', 'forge.lock')
    const lock = await readJson(lockPath)
    lock.plugins[0].outputs.droid = lock.plugins[0].outputs.droid.replace(/^./, (c: string) => (c === 'a' ? 'b' : 'a'))
    const tampered = JSON.stringify(lock, null, 2) + '\n'
    await writeFile(lockPath, tampered)
    const treeFile = join(proj, '.crucible', 'plugins', 'hello', '1.0.0', 'droid', 'skills', 'hello', 'SKILL.md')
    const treeBefore = await readFile(treeFile, 'utf8')
    const {exitCode, output} = await runSync(proj)
    expect(exitCode).toBe(1)
    expect(output).toContain('does not match the locked outputs')
    expect(output).toContain('hello')
    expect(await readFile(lockPath, 'utf8')).toBe(tampered)
    expect(await readFile(treeFile, 'utf8')).toBe(treeBefore)
  })

  it('AC-25 uninstall removes the compile manifests with the project state', async () => {
    const dir = getDir()
    const {proj} = await setup(dir)
    expect((await runSync(proj)).exitCode).toBe(0)
    expect(existsSync(join(proj, '.crucible', 'compile', 'droid.json'))).toBe(true)

    await runUninstallSession(proj, (cli) =>
      cli.waitForText('Continue?').pressKey(Y).waitForText(UNINSTALL_MESSAGES.done),
    )
    expect(existsSync(join(proj, '.crucible'))).toBe(false)
  })
})
