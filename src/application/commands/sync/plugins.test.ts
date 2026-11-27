import {mkdir, readFile, rm, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {describe, expect, it} from 'bun:test'

import {COMPILE_SUPPORT, COMPILER_VERSION} from '@domain/compile'
import type {PluginConfig} from '@domain/plugins'
import {pluginManifest} from '@e2e/fixtures/plugin-packages'
import {writeSourceTree} from '@e2e/fixtures/sources'

import {CommandError} from '../types'
import type {PluginPlan} from './plugins'
import {planPlugins, validatePluginScopes} from './plugins'

const entry = (scope?: 'project' | 'user'): PluginConfig => ({
  name: 'hello',
  source: {type: 'local', path: '/x'},
  ...(scope ? {scope} : {}),
})

describe('validatePluginScopes (spec 0003 §4)', () => {
  it('lets matching and defaulted scopes pass', () => {
    expect(() => validatePluginScopes([entry(), entry('project')], 'project')).not.toThrow()
    expect(() => validatePluginScopes([entry(), entry('user')], 'user')).not.toThrow()
    expect(() => validatePluginScopes([], 'project')).not.toThrow()
  })

  it('rejects a user entry in the project config, naming where it belongs and the command', () => {
    try {
      validatePluginScopes([entry('user')], 'project')
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(CommandError)
      const commandError = error as CommandError
      expect(commandError.message).toContain('"hello" has scope: user')
      expect(commandError.message).toContain('project config')
      expect(commandError.suggestion).toContain('~/.crucible/forge.config.yaml')
      expect(commandError.suggestion).toContain('forge sync --global')
    }
  })

  it('rejects a project entry in the user config, naming where it belongs and the command', () => {
    try {
      validatePluginScopes([entry('project')], 'user')
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(CommandError)
      const commandError = error as CommandError
      expect(commandError.message).toContain('"hello" has scope: project')
      expect(commandError.message).toContain('user config')
      expect(commandError.suggestion).toContain('.crucible/forge.config.yaml')
      expect(commandError.suggestion).toContain('forge sync')
    }
  })
})

/** The managed files of a plan, for content assertions. */
const files = (plan: PluginPlan) => plan.files

describe('planPlugins compile discipline (spec 0005 §5)', () => {
  const dir = useTmpDir('plugin-plan-compile')
  const helloPlugin: PluginConfig = {name: 'hello', source: {type: 'local', path: 'plugins/hello'}}
  const writeHello = (body = 'Hello\n') =>
    writeSourceTree(dir(), {
      'plugins/hello/plugin.json': pluginManifest('hello', '1.0.0'),
      'plugins/hello/skills/hello/SKILL.md': body,
    })
  const plan = (over: Partial<Parameters<typeof planPlugins>[0]> = {}) =>
    planPlugins({
      root: dir(),
      home: dir(),
      scope: 'project',
      plugins: [helloPlugin],
      enabled: new Set(['droid', 'claude-code']),
      hasExecutable: () => true,
      ...over,
    })
  /** Applies a plan to disk: writes the managed files, removes the pruned ones. */
  const commit = async ({files: managed, prune}: PluginPlan) => {
    for (const file of managed) {
      await mkdir(join(dir(), file.path, '..'), {recursive: true})
      await writeFile(join(dir(), file.path), file.content)
    }
    for (const path of prune) await rm(join(dir(), path), {force: true})
  }
  const lockPath = () => join(dir(), '.crucible', 'forge.lock')
  const readLock = async () => JSON.parse(await readFile(lockPath(), 'utf8'))
  const cacheFiles = (plan: PluginPlan) =>
    new Map(
      files(plan)
        .filter((file) => file.path.startsWith(join('.crucible', 'plugins')))
        .map((file) => [file.path, file.content]),
    )

  it('writes manifests and fresh compile entries on the first sync, then stays silent and idempotent', async () => {
    await writeHello()
    const first = await plan()
    expect(first.report?.compile).toEqual([])
    const paths = files(first)
      .map((file) => file.path)
      .sort()
    expect(paths).toContain(join('.crucible', 'compile', 'droid.json'))
    expect(paths).toContain(join('.crucible', 'compile', 'claude-code.json'))
    expect(paths).toContain(join('.crucible', 'compile', '.gitignore'))
    const manifest = JSON.parse(
      files(first)
        .find((file) => file.path.endsWith(`droid.json`))!
        .content.toString(),
    )
    expect(manifest).toMatchObject({
      schema: 1,
      harness: 'droid',
      scope: 'project',
      enabled: true,
      compiler: COMPILER_VERSION,
    })
    expect(manifest.components.every((row: {status: string}) => row.status === 'listed')).toBe(true)
    const lock = JSON.parse(
      files(first)
        .find((file) => file.path.endsWith('forge.lock'))!
        .content.toString(),
    )
    expect(lock.version).toBe(2)
    expect(lock.compile.droid).toMatchObject({enabled: true, compiler: COMPILER_VERSION})
    expect(lock.compile.droid.inputs).toMatch(/^sha256:[a-f0-9]{64}$/)

    await commit(first)
    const second = await plan()
    expect(second.report?.compile).toEqual([])
    expect(second.prune).toEqual([])
    expect(
      files(second)
        .find((file) => file.path.endsWith('forge.lock'))!
        .content.toString(),
    ).toBe(await readFile(lockPath(), 'utf8'))
  })

  it('shows the v0.8 upgrade line once, with the unit status counts', async () => {
    await writeHello()
    await commit(await plan())
    // Downgrade the committed lock to v0.8: version 1, no compile block.
    const v1 = await readLock()
    delete v1.compile
    v1.version = 1
    await writeFile(lockPath(), JSON.stringify(v1, null, 2) + '\n')

    const upgraded = await plan()
    const notes = upgraded.report?.compile ?? []
    expect(notes.map((note) => note.harness).sort()).toEqual(['claude-code', 'droid'])
    for (const note of notes) expect(note.upgrade?.listed).toBeGreaterThan(0)
    expect(notes.every((note) => note.upgrade?.deferred === 0)).toBe(true)

    await commit(upgraded)
    expect((await plan()).report?.compile).toEqual([])
  })

  it('names the changed input when a relock recompiles', async () => {
    await writeHello()
    await commit(await plan())
    const config = await plan({compile: {defer: ['hello']}})
    expect(config.report?.compile).toEqual([
      {harness: 'claude-code', recompiled: 'the compile config changed'},
      {harness: 'droid', recompiled: 'the compile config changed'},
    ])
    await commit(config)
    await writeHello('Hello again\n')
    const content = await plan()
    expect(content.report?.compile).toEqual([
      {harness: 'claude-code', recompiled: 'the plugin set changed'},
      {harness: 'droid', recompiled: 'the plugin set changed'},
    ])
  })

  it('refuses a lock written by a newer compiler before any write', async () => {
    await writeHello()
    await commit(await plan())
    const lock = await readLock()
    lock.compile.droid = {enabled: true, inputs: 'sha256:' + '0'.repeat(64), compiler: COMPILER_VERSION + 1}
    await writeFile(lockPath(), JSON.stringify(lock, null, 2) + '\n')
    const error = await plan().catch((e: unknown) => e)
    expect(error).toBeInstanceOf(CommandError)
    expect((error as Error).message).toContain('compiler')
    expect((error as Error).message).toContain('upgrade forge')
  })

  it('fails with CompileMismatch when the inputs are unchanged but the output differs', async () => {
    await writeHello()
    await commit(await plan())
    const changed = await plan({
      compileRun: (input) => ({
        packages: input.packages.map((pkg) => ({pkg, changed: true})),
        links: {},
        components: [],
      }),
    }).catch((e: unknown) => e)
    expect(changed).toBeInstanceOf(CommandError)
    expect((changed as Error).message).toContain('does not match the locked outputs')
    expect((changed as Error).message).toContain('"hello"')
  })

  it('reports harnesses without compile support and still delivers the v0.8 bytes', async () => {
    await writeHello()
    const unsupported = await plan({compileSupport: {}})
    expect(unsupported.report?.compile).toEqual([
      {harness: 'claude-code', unsupported: true},
      {harness: 'droid', unsupported: true},
    ])
    const supported = await plan()
    // No manifests without compile support, and the delivered bytes are the same.
    expect(files(unsupported).some((file) => file.path.includes('compile'))).toBe(false)
    expect([...cacheFiles(unsupported).keys()].sort()).toEqual([...cacheFiles(supported).keys()].sort())
    for (const [path, content] of cacheFiles(unsupported)) expect(content).toEqual(cacheFiles(supported).get(path)!)
  })

  it('compile.enabled: false locks enabled: false and delivers byte-identical output', async () => {
    await writeHello()
    const disabled = await plan({compile: {enabled: false}})
    const lock = JSON.parse(
      files(disabled)
        .find((file) => file.path.endsWith('forge.lock'))!
        .content.toString(),
    )
    expect(lock.compile).toEqual({
      'claude-code': {enabled: false, compiler: COMPILER_VERSION},
      droid: {enabled: false, compiler: COMPILER_VERSION},
    })
    expect(files(disabled).some((file) => file.path.includes(join('compile')))).toBe(false)
    const enabled = await plan()
    expect([...cacheFiles(disabled).keys()].sort()).toEqual([...cacheFiles(enabled).keys()].sort())
    for (const [path, content] of cacheFiles(disabled)) expect(content).toEqual(cacheFiles(enabled).get(path)!)
  })

  it('prunes the manifest of a harness no longer compiled', async () => {
    await writeHello()
    await commit(await plan())
    const droidOnly = await plan({compileSupport: {droid: COMPILE_SUPPORT.droid}})
    expect(droidOnly.report?.compile).toEqual([{harness: 'claude-code', unsupported: true}])
    expect(droidOnly.prune).toEqual([join('.crucible', 'compile', 'claude-code.json')])
  })

  it('AC-2 produces identical manifests and locks across roots and a reordered plugins list', async () => {
    // planPlugins takes no telemetry input at all, so differing telemetry settings cannot enter the output.
    const zetaPlugin: PluginConfig = {name: 'zeta', source: {type: 'local', path: 'plugins/zeta'}}
    const write = (root: string) =>
      writeSourceTree(root, {
        'plugins/hello/plugin.json': pluginManifest('hello', '1.0.0'),
        'plugins/hello/skills/hello/SKILL.md': 'Hello\n',
        'plugins/zeta/plugin.json': pluginManifest('zeta', '2.0.0'),
        'plugins/zeta/skills/zeta/SKILL.md': 'Zeta\n',
      })
    const roots = [join(dir(), 'root-a'), join(dir(), 'root-b')]
    for (const root of roots) await write(root)
    const planIn = (root: string, plugins: PluginConfig[]) =>
      planPlugins({
        root,
        home: root,
        scope: 'project',
        plugins,
        enabled: new Set(['droid', 'claude-code']),
        hasExecutable: () => true,
      })
    const a = await planIn(roots[0], [helloPlugin, zetaPlugin])
    const b = await planIn(roots[1], [zetaPlugin, helloPlugin])
    const pick = (plan: PluginPlan, suffix: string) =>
      files(plan)
        .find((file) => file.path.endsWith(suffix))!
        .content.toString()
    for (const suffix of ['forge.lock', join('compile', 'droid.json'), join('compile', 'claude-code.json')])
      expect(pick(b, suffix)).toBe(pick(a, suffix))
  })
})
