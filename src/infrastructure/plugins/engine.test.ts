import {existsSync} from 'node:fs'
import {chmod, cp, mkdir, readdir, rename, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {basename, dirname, isAbsolute, join, relative} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {afterAll, beforeAll, describe, expect, it} from 'bun:test'

import {COMPILE_SUPPORT, COMPILER_VERSION, emittedVersion, versionSuffix} from '@domain/compile'
import {effectiveCompileConfig} from '@domain/config/types'
import type {PluginConfig, PluginFile, PluginHarnessId, PluginLock, PluginPackage} from '@domain/plugins'
import {emptyPluginLock, hashDelivered, hashPluginFiles, PLUGIN_EMITTERS} from '@domain/plugins'
import {hashContent} from '@domain/sync/state'
import {runGit} from '@infrastructure/source/git/load'
import {HELLO_PLUGIN_V1, HELLO_PLUGIN_V2, pluginManifest} from '@e2e/fixtures/plugin-packages'
import {writeSourceTree} from '@e2e/fixtures/sources'
import {createBareRepo, setBareRepoRef} from '@e2e/framework/git'

import {createTestSandbox} from '../../../scripts/test-sandbox'
import {
  lockPlugins,
  marketplaceCatalog,
  pluginCacheFiles,
  PluginSourceError,
  PluginValidationError,
  serializePluginLock,
  unreferencedCacheDirs,
} from '.'
import {readCachedPlugin} from './cache'
import {pluginGitCacheDir, readGitPlugin} from './git'

/** Stand-in emitter: components in the plugin directory, rules as Claude rule files outside it. */
const deliverTo = (harness: PluginHarnessId) => (pkg: PluginPackage) => {
  const components = pkg.components[harness]
  return {
    plugin: components.filter((c) => c.kind !== 'rule').flatMap((c) => c.files),
    claudeRules: components
      .filter((c) => c.kind === 'rule')
      .map((c) => ({path: `${pkg.manifest.name}--${c.name}.md`, content: c.files[0].content})),
  }
}
const deliver = {'claude-code': deliverTo('claude-code'), droid: deliverTo('droid')}
const dir = useTmpDir('plugin-engine')
const lock = (plugins: PluginConfig[], previous: PluginLock = emptyPluginLock(), root = dir()) =>
  lockPlugins({
    plugins,
    lock: previous,
    context: {root, home: root},
    cacheRoot: join(root, '.crucible', 'plugins'),
    defaultHarnesses: ['claude-code', 'droid'],
    deliver,
  })
const skillText = (pkg: PluginPackage) =>
  new TextDecoder().decode(pkg.files.find((file) => file.path === 'skills/hello/SKILL.md')!.content)

describe('git plugin sources', () => {
  let fixture: ReturnType<typeof createTestSandbox> | undefined
  let template = ''
  beforeAll(async () => {
    fixture = createTestSandbox('plugin-git-history-')
    template = await createBareRepo(fixture.project, HELLO_PLUGIN_V1)
  })
  afterAll(() => fixture?.dispose())
  const repository = async () => {
    const path = join(dir(), 'repo.git')
    await cp(template, path, {recursive: true})
    return path
  }
  const commit = async (bare: string, ref: string) => (await runGit(bare, ['rev-parse', `${ref}^{commit}`])).trim()
  const gitCache = (url: string) => pluginGitCacheDir(url, 'sha1')
  const legacyGitCache = (url: string) => join(tmpdir(), 'forge-cache', 'plugins', hashContent(url))

  it('AC-2,3 locks the commit a branch, tag or SHA resolves to and keeps it after the branch moves', async () => {
    const url = await repository()
    const source = {type: 'git' as const, url, path: 'plugins/hello'}
    const plugin: PluginConfig = {name: 'hello', source}
    const first = await lock([plugin])
    const v1 = await commit(url, 'main')
    expect(first.plugins[0].action).toBe('resolve')
    expect(first.lock.plugins[0]).toMatchObject({
      version: '1.0.0',
      source: {type: 'git', url, path: 'plugins/hello', ref: 'main'},
      resolved: v1,
    })
    await setBareRepoRef(dir(), url, 'refs/heads/main', HELLO_PLUGIN_V2)
    await setBareRepoRef(dir(), url, 'refs/tags/v2', HELLO_PLUGIN_V2)
    const again = await lock([plugin], first.lock)
    expect(again.plugins[0].action).toBe('locked')
    expect(serializePluginLock(again.lock)).toBe(serializePluginLock(first.lock))
    expect(skillText(again.plugins[0].pkg)).toContain('Hello v1')

    await rm(gitCache(url), {recursive: true, force: true})
    const cold = await lock([plugin], first.lock)
    expect(cold.lock.plugins[0].resolved).toBe(v1)
    expect(skillText(cold.plugins[0].pkg)).toContain('Hello v1')

    const tagged = await lock([{...plugin, source: {...source, ref: 'v2'}}], first.lock)
    expect(tagged.plugins[0]).toMatchObject({action: 'relock', reason: 'source descriptor changed'})
    expect(tagged.lock.plugins[0]).toMatchObject({version: '1.1.0', resolved: await commit(url, 'v2')})
    const pinned = await lock([{...plugin, source: {...source, ref: v1}}])
    expect(pinned.lock.plugins[0].resolved).toBe(v1)
  })

  it('AC-3,6 installs from the forge cache offline and aborts naming the plugin on an unreachable cache miss', async () => {
    const url = await repository()
    const plugin: PluginConfig = {name: 'hello', source: {type: 'git', url, path: 'plugins/hello'}}
    const first = await lock([plugin])
    const locked = first.plugins[0]
    const cacheRoot = join(dir(), '.crucible', 'plugins')
    for (const file of pluginCacheFiles(locked.entry, locked.pkg.files, locked.outputs)) {
      await mkdir(join(cacheRoot, file.path, '..'), {recursive: true})
      await writeFile(join(cacheRoot, file.path), file.content)
    }
    expect(existsSync(join(cacheRoot, '.gitignore'))).toBe(true)
    expect(existsSync(join(cacheRoot, 'hello/1.0.0/claude-code/skills/hello/SKILL.md'))).toBe(true)
    await mkdir(join(cacheRoot, 'hello', '0.9.0'), {recursive: true})
    await mkdir(join(cacheRoot, 'gone', '1.0.0'), {recursive: true})
    await mkdir(join(cacheRoot, '.claude-plugin'), {recursive: true})
    await mkdir(join(cacheRoot, '.factory-plugin'), {recursive: true})
    expect((await unreferencedCacheDirs(cacheRoot, first.lock)).sort()).toEqual(['gone', 'hello/0.9.0'])
    await rm(gitCache(url), {recursive: true, force: true})
    await rename(url, `${url}.offline`)
    expect(serializePluginLock((await lock([plugin], first.lock)).lock)).toBe(serializePluginLock(first.lock))

    await rm(join(dir(), '.crucible'), {recursive: true, force: true})
    const error = await lock([plugin], first.lock).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(PluginSourceError)
    expect((error as Error).message).toContain('Plugin "hello" source error')
    expect(existsSync(join(dir(), '.crucible'))).toBe(false)
  })
  it('AC-2,3 resolves a relative url against the working directory for a branch, a SHA and a locked commit', async () => {
    const url = await repository()
    const source = {type: 'git' as const, url: relative(process.cwd(), url), path: 'plugins/hello'}
    expect(isAbsolute(source.url)).toBe(false)
    const plugin: PluginConfig = {name: 'hello', source}
    const v1 = await commit(url, 'main')
    const first = await lock([plugin])
    expect(first.lock.plugins[0].resolved).toBe(v1)
    expect(existsSync(gitCache(url))).toBe(true)
    await rm(gitCache(url), {recursive: true, force: true})
    expect((await lock([plugin], first.lock)).lock.plugins[0].resolved).toBe(v1)
    await rm(gitCache(url), {recursive: true, force: true})
    expect((await lock([{...plugin, source: {...source, ref: v1}}])).lock.plugins[0].resolved).toBe(v1)
  })

  it('AC-3 never shows other processes a half-initialised cache and removes only what a failed fetch created', async () => {
    const url = await repository()
    const watched = [gitCache(url), legacyGitCache(url)]
    const seen = new Set<string>()
    let settled = false
    const plugin: PluginConfig = {name: 'hello', source: {type: 'git', url, path: 'plugins/hello', ref: 'missing'}}
    const failing = lock([plugin])
      .catch((e: unknown) => e)
      .finally(() => (settled = true))
    while (!settled) {
      for (const path of watched) if (existsSync(path)) seen.add(path)
      await new Promise((wake) => setTimeout(wake, 1))
    }
    expect(await failing).toBeInstanceOf(PluginSourceError)
    expect([...seen]).toEqual([])
    const staged = (await readdir(dirname(gitCache(url)))).filter((name) =>
      name.startsWith(`${basename(gitCache(url))}.`),
    )
    expect(staged).toEqual([])
  })

  it('AC-3 recovers from a cache an earlier forge left in the wrong object format', async () => {
    const url = await repository()
    const legacy = legacyGitCache(url)
    await rm(legacy, {recursive: true, force: true})
    await mkdir(legacy, {recursive: true})
    await runGit(legacy, ['init', '--bare', '--quiet', '--object-format=sha256'])
    try {
      const plugin: PluginConfig = {name: 'hello', source: {type: 'git', url, path: 'plugins/hello'}}
      expect((await lock([plugin])).lock.plugins[0].resolved).toBe(await commit(url, 'main'))
    } finally {
      await rm(legacy, {recursive: true, force: true})
    }
  })

  it('AC-2,3 a cold cache uses the remote object format, not the local default', async () => {
    const url = await repository()
    const source = {type: 'git' as const, url, path: 'plugins/hello'}
    const plugin: PluginConfig = {name: 'hello', source}
    const head = await commit(url, 'main')
    const previous = process.env.GIT_DEFAULT_HASH
    process.env.GIT_DEFAULT_HASH = head.length === 40 ? 'sha256' : 'sha1'
    try {
      const first = await lock([plugin])
      expect(first.lock.plugins[0].resolved).toBe(head)
      await rm(gitCache(url), {recursive: true, force: true})
      expect((await lock([plugin], first.lock)).lock.plugins[0].resolved).toBe(head)
      await rm(gitCache(url), {recursive: true, force: true})
      expect((await lock([{...plugin, source: {...source, ref: head}}])).lock.plugins[0].resolved).toBe(head)
    } finally {
      if (previous === undefined) delete process.env.GIT_DEFAULT_HASH
      else process.env.GIT_DEFAULT_HASH = previous
    }
  })
})

describe('local plugin sources', () => {
  const write = (root: string, files: Record<string, string>, prefix = 'plugins/hello') =>
    writeSourceTree(root, Object.fromEntries(Object.entries(files).map(([path, text]) => [`${prefix}/${path}`, text])))
  const hello = {
    'plugin.json': pluginManifest('hello', '1.0.0'),
    'skills/hello/SKILL.md': 'Hello\n',
    'dev.crucibledx.forge/rules/style.md': 'Be brief.\n',
  }
  const plugin: PluginConfig = {name: 'hello', source: {type: 'local', path: 'plugins/hello'}}

  it('AC-4 creates, keeps, and relocks on changed content or a changed descriptor', async () => {
    await write(dir(), hello)
    const first = await lock([plugin])
    expect(first.plugins[0].action).toBe('resolve')
    expect(first.lock.plugins[0].resolved).toBeUndefined()
    expect(first.lock.plugins[0].contentHash).toBe(hashPluginFiles(first.plugins[0].pkg.files))
    expect(first.lock.plugins[0].outputs).toEqual({
      'claude-code': hashDelivered(first.plugins[0].outputs['claude-code']),
      droid: hashDelivered(first.plugins[0].outputs.droid),
    })
    const kept = await lock([plugin], first.lock)
    expect(kept.plugins[0].action).toBe('locked')
    expect(kept.lock).toEqual(first.lock)
    await write(dir(), {'skills/hello/SKILL.md': 'Hello again\n'})
    const changed = await lock([plugin], first.lock)
    expect(changed.plugins[0]).toMatchObject({action: 'relock', reason: 'local content changed'})
    expect(changed.lock.plugins[0].contentHash).not.toBe(first.lock.plugins[0].contentHash)
    await write(dir(), hello, 'other/hello')
    const moved = await lock([{...plugin, source: {type: 'local', path: 'other/hello'}}], changed.lock)
    expect(moved.plugins[0]).toMatchObject({action: 'relock', reason: 'source descriptor changed'})
  })

  it('AC-4,6 aborts on a missing path or an invalid package before writing, and reports removals', async () => {
    const missing = await lock([plugin]).catch((e: unknown) => e)
    expect(missing).toBeInstanceOf(PluginSourceError)
    expect((missing as Error).message).toContain('Plugin "hello" source error: local path does not exist')
    await write(dir(), {...hello, 'plugin.json': pluginManifest('hello', 'one')})
    const invalid = await lock([plugin]).catch((e: unknown) => e)
    expect(invalid).toBeInstanceOf(PluginValidationError)
    expect((invalid as Error).message).toContain('Plugin "hello" failed validation')
    expect((invalid as Error).message).toContain('"version" must be a semantic version')
    await write(dir(), {...hello, 'plugin.json': pluginManifest('other', '1.0.0')})
    expect(await lock([plugin]).catch((e: unknown) => (e as Error).message)).toContain(
      'does not match the configured name',
    )
    expect(existsSync(join(dir(), '.crucible'))).toBe(false)
    await write(dir(), hello)
    expect((await lock([], (await lock([plugin])).lock)).removed).toEqual(['hello'])
  })

  it('AC-5 variants depend only on delivered bytes, not on config order, project path, scope or time', async () => {
    const other = {'plugin.json': pluginManifest('zeta', '2.0.0'), 'skills/z/SKILL.md': 'Z\n'}
    const roots = [join(dir(), 'project-a'), join(dir(), 'nested', 'project-b')]
    for (const root of roots) {
      await write(root, hello)
      await write(root, other, 'plugins/zeta')
    }
    const zeta: PluginConfig = {name: 'zeta', source: {type: 'local', path: 'plugins/zeta'}, scope: 'user'}
    const a = await lock([plugin, zeta], emptyPluginLock(), roots[0])
    const b = await lock([zeta, plugin], emptyPluginLock(), roots[1])
    expect(Object.keys(a.lock.variants)).toEqual(['claude-code', 'droid'])
    expect(serializePluginLock(b.lock)).toBe(serializePluginLock(a.lock))

    await write(roots[1], {'skills/hello/SKILL.md': 'Hello!\n'})
    const byte = await lock([plugin, zeta], emptyPluginLock(), roots[1])
    expect(byte.lock.variants['claude-code']).not.toBe(a.lock.variants['claude-code'])
    expect(byte.lock.variants.droid).not.toBe(a.lock.variants.droid)

    await write(roots[0], {'dev.crucibledx.forge/rules/style.md': 'Be very brief.\n'})
    const rule = await lock([plugin, zeta], emptyPluginLock(), roots[0])
    expect(rule.lock.plugins[0].version).toBe('1.0.0')
    expect(rule.lock.variants['claude-code']).not.toBe(a.lock.variants['claude-code'])
    expect(rule.lock.variants.droid).not.toBe(a.lock.variants.droid)
  })

  it('targets configured harnesses, skipping those without an emitter or outside the manifest list', async () => {
    await write(dir(), {
      ...hello,
      'plugin.json': pluginManifest('hello', '1.0.0', {
        extensions: {'dev.crucibledx.forge': {harnesses: ['droid', 'cursor']}},
      }),
    })
    const result = await lock([{...plugin, harnesses: ['claude-code', 'droid', 'cursor']}])
    expect(Object.keys(result.lock.plugins[0].outputs)).toEqual(['droid'])
    expect(result.plugins[0].skipped).toEqual([
      {harness: 'claude-code', reason: 'not-in-manifest'},
      {harness: 'cursor', reason: 'no-plugin-support'},
    ])
  })

  it('freezes the previous output of a disabled harness instead of re-emitting it (retained registration)', async () => {
    await write(dir(), hello)
    const first = await lock([plugin])
    expect(Object.keys(first.lock.plugins[0].outputs).sort()).toEqual(['claude-code', 'droid'])
    const retainDroid = {
      plugins: [plugin],
      lock: first.lock,
      context: {root: dir(), home: dir()},
      cacheRoot: join(dir(), '.crucible', 'plugins'),
      defaultHarnesses: ['claude-code'],
      retain: ['droid'],
      deliver,
    }

    // The lock keeps the droid output hash, but nothing is re-emitted for the disabled harness.
    const retained = await lockPlugins(retainDroid)
    expect(Object.keys(retained.lock.plugins[0].outputs).sort()).toEqual(['claude-code', 'droid'])
    expect(retained.lock.plugins[0].outputs.droid).toBe(first.lock.plugins[0].outputs.droid)
    expect(Object.keys(retained.plugins[0].outputs)).toEqual(['claude-code'])
    expect(retained.plugins[0].retainedOutputs).toEqual({droid: first.lock.plugins[0].outputs.droid})

    // A manifest that no longer lists the disabled harness still keeps its frozen output.
    await write(dir(), {
      ...hello,
      'plugin.json': pluginManifest('hello', '1.0.0', {
        extensions: {'dev.crucibledx.forge': {harnesses: ['claude-code']}},
      }),
    })
    const narrowed = await lockPlugins({...retainDroid, lock: retained.lock})
    expect(narrowed.lock.plugins[0].outputs.droid).toBe(first.lock.plugins[0].outputs.droid)
    expect(narrowed.plugins[0].skipped).toEqual([])

    // Without a retained registration the disabled harness's output is dropped as before.
    const dropped = await lockPlugins({...retainDroid, retain: []})
    expect(Object.keys(dropped.lock.plugins[0].outputs)).toEqual(['claude-code'])
  })

  it.skipIf(process.platform === 'win32')('keeps the executable bit through acquisition and the cache', async () => {
    await write(dir(), {...hello, 'bin/server': '#!/bin/sh\n'})
    await chmod(join(dir(), 'plugins/hello/bin/server'), 0o755)
    const result = await lock([plugin])
    const executable = (files: PluginFile[]) => files.filter((f) => f.executable).map((f) => f.path)
    expect(executable(result.plugins[0].pkg.files)).toEqual(['bin/server'])
    const cacheRoot = join(dir(), '.crucible', 'plugins')
    const cached = pluginCacheFiles(result.lock.plugins[0], result.plugins[0].pkg.files, result.plugins[0].outputs)
    expect(executable(cached)).toEqual(['hello/1.0.0/source/bin/server'])
    for (const file of cached) {
      await mkdir(join(cacheRoot, file.path, '..'), {recursive: true})
      await writeFile(join(cacheRoot, file.path), file.content, {mode: file.executable ? 0o755 : 0o644})
    }
    expect(executable((await readCachedPlugin(cacheRoot, result.lock.plugins[0]))!)).toEqual(['bin/server'])

    const bare = join(dir(), 'exec.git')
    await mkdir(bare)
    await runGit(bare, ['init', '--bare', '--quiet'])
    const env = {GIT_INDEX_FILE: join(dir(), 'exec.index')}
    for (const [mode, path] of [
      ['100755', 'bin/server'],
      ['100644', 'plugin.json'],
    ]) {
      const blob = (await runGit(bare, ['hash-object', '-w', join(dir(), 'plugins/hello', path)])).trim()
      await runGit(bare, ['update-index', '--add', '--cacheinfo', `${mode},${blob},plugins/x/${path}`], {env})
    }
    const tree = (await runGit(bare, ['write-tree'], {env})).trim()
    expect(executable(await readGitPlugin(bare, tree, 'plugins/x'))).toEqual(['bin/server'])
  })
})

describe('compile units (spec 0005 §1, §5)', () => {
  const write = (root: string, files: Record<string, string>, prefix = 'plugins/hello') =>
    writeSourceTree(root, Object.fromEntries(Object.entries(files).map(([path, text]) => [`${prefix}/${path}`, text])))
  const hello = {
    'plugin.json': pluginManifest('hello', '1.0.0'),
    'skills/hello/SKILL.md': 'Hello\n',
  }
  const plugin: PluginConfig = {name: 'hello', source: {type: 'local', path: 'plugins/hello'}}
  const compileInput = {scope: 'project' as const, config: effectiveCompileConfig(), support: COMPILE_SUPPORT}
  const lockCompiled = (previous: PluginLock = emptyPluginLock(), compile?: object) =>
    lockPlugins({
      plugins: [plugin],
      lock: previous,
      context: {root: dir(), home: dir()},
      cacheRoot: join(dir(), '.crucible', 'plugins'),
      defaultHarnesses: ['claude-code', 'droid'],
      deliver,
      compile: {...compileInput, ...compile},
    })

  it('AC-1 compiles every delivered harness as the identity: same outputs, fresh compile lock entries', async () => {
    await write(dir(), hello)
    const plain = await lock([plugin])
    const compiled = await lockCompiled()
    // Identity: the delivered bytes and output hashes are exactly the v0.8 ones, and no emitted version is set.
    expect(compiled.plugins[0].outputs).toEqual(plain.plugins[0].outputs)
    expect(compiled.lock.plugins[0]).toEqual(plain.lock.plugins[0])
    expect(compiled.lock.plugins[0].emitted).toBeUndefined()
    for (const harness of ['claude-code', 'droid']) {
      expect(compiled.compiles[harness].components.map((row) => row.status)).toEqual(['listed'])
      expect(compiled.compileLock[harness]).toMatchObject({enabled: true, compiler: COMPILER_VERSION})
      expect(compiled.compileLock[harness].inputs).toMatch(/^sha256:[a-f0-9]{64}$/)
    }
    // The inputs hash is stable for the same unit across runs.
    const again = await lockCompiled(compiled.lock)
    expect(again.compileLock.droid.inputs).toBe(compiled.compileLock.droid.inputs)
  })

  it('stamps the emitted version when compile changes bytes, hashed over the stamped tree', async () => {
    await write(dir(), hello)
    const changed = await lockPlugins({
      plugins: [plugin],
      lock: emptyPluginLock(),
      context: {root: dir(), home: dir()},
      cacheRoot: join(dir(), '.crucible', 'plugins'),
      defaultHarnesses: ['claude-code', 'droid'],
      deliver: {droid: PLUGIN_EMITTERS.factory, 'claude-code': PLUGIN_EMITTERS.claude},
      compile: {
        ...compileInput,
        run: (input: {packages: PluginPackage[]}) => ({
          packages: input.packages.map((pkg) => ({pkg, changed: true})),
          links: {},
          components: [],
        }),
      },
    })
    const entry = changed.lock.plugins[0]
    expect(entry.emitted?.droid).toMatch(/^1\.0\.0\+c\.[0-9a-f]{8}$/)
    expect(entry.emitted?.['claude-code']).toMatch(/^1\.0\.0-c\.[0-9a-f]{8}$/)
    // The emitted version is the source version suffixed by the first 8 hex of the unstamped tree's hash,
    // recomputed here from the acquired package without the engine's own stamping code.
    const unstamped = {
      droid: PLUGIN_EMITTERS.factory(changed.plugins[0].pkg),
      'claude-code': PLUGIN_EMITTERS.claude(changed.plugins[0].pkg),
    }
    expect(entry.emitted?.droid).toBe(emittedVersion('1.0.0', versionSuffix(hashDelivered(unstamped.droid)), 'build'))
    expect(entry.emitted?.['claude-code']).toBe(
      emittedVersion('1.0.0', versionSuffix(hashDelivered(unstamped['claude-code'])), 'prerelease'),
    )
    // The catalog addresses the emitted tree by the emitted version.
    expect(JSON.parse(marketplaceCatalog('m', 'droid', [entry])).plugins).toEqual([
      {name: 'hello', version: entry.emitted!.droid, source: `./hello/${entry.emitted!.droid}/droid`},
    ])
    for (const harness of ['claude-code', 'droid'] as const) {
      const manifest = changed.plugins[0].outputs[harness].plugin.find(
        (file) => file.path === '.claude-plugin/plugin.json',
      )!
      expect(JSON.parse(new TextDecoder().decode(manifest.content)).version).toBe(entry.emitted![harness])
      expect(entry.outputs[harness]).toBe(hashDelivered(changed.plugins[0].outputs[harness]))
    }
    // The cache and catalogs address the emitted trees by the emitted version.
    const paths = pluginCacheFiles(entry, changed.plugins[0].pkg.files, changed.plugins[0].outputs).map((f) => f.path)
    expect(paths).toContain(`hello/${entry.emitted!.droid}/droid/.claude-plugin/plugin.json`)
    expect(paths).toContain('hello/1.0.0/source/skills/hello/SKILL.md')
  })

  const changedRun = (input: {packages: PluginPackage[]}) => ({
    packages: input.packages.map((pkg) => ({pkg, changed: true})),
    links: {},
    components: [],
  })

  it('keeps the source and emitted cache trees referenced and prunes only what the lock does not name', async () => {
    await write(dir(), hello)
    const changed = await lockCompiled(emptyPluginLock(), {run: changedRun})
    const cacheRoot = join(dir(), '.crucible', 'plugins')
    const emittedDroid = changed.lock.plugins[0].emitted!.droid
    for (const version of ['1.0.0', emittedDroid, '9.9.9'])
      await mkdir(join(cacheRoot, 'hello', version), {recursive: true})
    await mkdir(join(cacheRoot, 'gone', '1.0.0'), {recursive: true})
    expect((await unreferencedCacheDirs(cacheRoot, changed.lock)).sort()).toEqual(['gone', 'hello/9.9.9'])
  })

  it('keeps the emitted version and output hash of a disabled harness across consecutive syncs', async () => {
    await write(dir(), hello)
    const changed = await lockCompiled(emptyPluginLock(), {run: changedRun})
    const emittedDroid = changed.lock.plugins[0].emitted?.droid
    expect(emittedDroid).toMatch(/^1\.0\.0\+c\.[0-9a-f]{8}$/)
    const retain = {
      plugins: [plugin],
      context: {root: dir(), home: dir()},
      cacheRoot: join(dir(), '.crucible', 'plugins'),
      defaultHarnesses: ['claude-code'],
      retain: ['droid'],
      deliver,
      compile: compileInput,
    }
    // Frozen retention carries the stamped identity forward, so the second disabled sync's catalog entry and
    // cache path still resolve against the emitted tree instead of falling back to the source version.
    const once = await lockPlugins({...retain, lock: changed.lock})
    expect(once.lock.plugins[0].emitted?.droid).toBe(emittedDroid)
    expect(once.lock.plugins[0].outputs.droid).toBe(changed.lock.plugins[0].outputs.droid)
    const twice = await lockPlugins({...retain, lock: once.lock})
    expect(twice.lock.plugins[0].emitted?.droid).toBe(emittedDroid)
    expect(twice.lock.plugins[0].outputs.droid).toBe(changed.lock.plugins[0].outputs.droid)
  })

  it('compile.enabled: false is the v0.8 identity with no compile records', async () => {
    await write(dir(), hello)
    const disabled = await lockCompiled(emptyPluginLock(), {config: effectiveCompileConfig({enabled: false})})
    expect(disabled.compiles).toEqual({})
    expect(disabled.compileLock).toEqual({})
    const plain = await lock([plugin])
    expect(disabled.plugins[0].outputs).toEqual(plain.plugins[0].outputs)
  })
})
