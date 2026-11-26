import {existsSync} from 'node:fs'
import {cp, mkdir, rename, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {afterAll, beforeAll, describe, expect, it} from 'bun:test'

import type {PluginConfig, PluginHarnessId, PluginLock, PluginPackage} from '@domain/plugins'
import {emptyPluginLock, hashDelivered, hashPluginFiles} from '@domain/plugins'
import {hashContent} from '@domain/sync/state'
import {runGit} from '@infrastructure/source/git/load'
import {HELLO_PLUGIN_V1, HELLO_PLUGIN_V2, pluginManifest} from '@e2e/fixtures/plugin-packages'
import {writeSourceTree} from '@e2e/fixtures/sources'
import {createBareRepo, setBareRepoRef} from '@e2e/framework/git'

import {createTestSandbox} from '../../../scripts/test-sandbox'
import {
  lockPlugins,
  pluginCacheFiles,
  PluginSourceError,
  PluginValidationError,
  serializePluginLock,
  unreferencedCacheDirs,
} from '.'

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
  const gitCache = (url: string) => join(tmpdir(), 'forge-cache', 'plugins', hashContent(url))

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
})
