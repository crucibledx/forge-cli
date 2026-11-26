import {mkdir, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {describe, expect, it} from 'bun:test'

import {lockedSource, portabilityReport, sourceWarnings} from '@domain/plugins'
import {projectConfigSchema} from '@infrastructure/config/schema'
import {COVER_ALL_DIR, COVER_ALL_EXPECTED, PLUGIN_SCHEMA_ID, pluginManifest} from '@e2e/fixtures/plugin-packages'

import {
  checkManifest,
  checkPluginDirectory,
  parsePluginLock,
  PluginLockError,
  pluginsConfigSchema,
  readPluginLock,
} from '.'

const base = {$schema: PLUGIN_SCHEMA_ID, name: 'demo', version: '1.0.0'}

describe('AC-1 manifest validation', () => {
  it('accepts the conformant cover-all package and reports its portability', async () => {
    const check = await checkPluginDirectory(COVER_ALL_DIR)
    expect(check.errors).toEqual([])
    expect(check.warnings).toEqual([])
    expect(portabilityReport(check.pkg!)).toEqual(await Bun.file(COVER_ALL_EXPECTED).json())
  })
  it.each([
    ['missing $schema', {name: 'demo', version: '1.0.0'}, 'missing required field "$schema"'],
    ['foreign $schema', {...base, $schema: 'https://example.com/schema.json'}, 'plugin.json/$schema'],
    ['missing name', {$schema: PLUGIN_SCHEMA_ID, version: '1.0.0'}, 'missing required field "name"'],
    ['invalid name', {...base, name: 'My-Plugin'}, 'plugin.json/name'],
    ['missing version', {$schema: PLUGIN_SCHEMA_ID, name: 'demo'}, '"version" must be a semantic version'],
    ['non-semver version', {...base, version: '1.0'}, '"version" must be a semantic version'],
    ['bad author field', {...base, author: {name: 'a', role: 'b'}}, 'plugin.json/author'],
    [
      'newer forge required',
      {...base, extensions: {'dev.crucibledx.forge': {minForgeVersion: '99.0.0'}}},
      'upgrade forge',
    ],
    ['bad forge extension', {...base, extensions: {'dev.crucibledx.forge': {harnesses: 'droid'}}}, '.harnesses'],
  ])('rejects %s', (_, raw, message) => {
    const check = checkManifest(raw, '0.8.0')
    expect(check.manifest).toBeUndefined()
    expect(check.errors.join('\n')).toContain(message)
  })
  it('warns on unknown top-level fields and a non-object extensions, and still accepts', () => {
    const check = checkManifest({...base, homepage: 'x', engines: {}, extensions: 'nope'}, '0.8.0')
    expect(check.errors).toEqual([])
    expect(check.manifest).toMatchObject({name: 'demo', version: '1.0.0'})
    expect(check.warnings).toEqual([
      'plugin.json: unknown top-level field "engines" ignored',
      'plugin.json: "extensions" is not an object and was ignored',
    ])
  })
  it('ignores extension namespaces forge does not implement', () => {
    expect(checkManifest({...base, extensions: {'com.example': {anything: 1}}}, '0.8.0').errors).toEqual([])
  })
  it('rejects an invalid mcp.json, unparseable component JSON and a missing manifest', async () => {
    const dir = await fixtureDir({
      'plugin.json': pluginManifest('demo', '1.0.0'),
      'mcp.json': JSON.stringify({mcpServers: {}}),
      'dev.crucibledx.forge/hooks/hooks.json': '{',
    })
    const check = await checkPluginDirectory(dir)
    expect(check.pkg).toBeUndefined()
    expect(check.errors.join('\n')).toContain('mcp.json: missing required field "$schema"')
    expect(check.errors.join('\n')).toContain('dev.crucibledx.forge/hooks/hooks.json: not valid JSON')
    expect((await checkPluginDirectory(join(dir, 'dev.crucibledx.forge'))).errors).toEqual([
      'plugin.json: missing at the package root',
    ])
  })
})

const dir = useTmpDir('plugin-infra')
async function fixtureDir(files: Record<string, string>): Promise<string> {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(dir(), 'pkg', path, '..'), {recursive: true})
    await writeFile(join(dir(), 'pkg', path), content)
  }
  return join(dir(), 'pkg')
}

describe('AC-2 plugin source config', () => {
  const parse = (source: object) => pluginsConfigSchema.parse([{name: 'p', source}])[0]
  it('keeps the source as written, defaulting ref to main only in the lock descriptor', () => {
    const plugin = parse({type: 'git', url: 'git@example.com:x.git', path: 'plugins/p'})
    expect(plugin.source).toEqual({type: 'git', url: 'git@example.com:x.git', path: 'plugins/p'})
    expect(lockedSource(plugin.source)).toMatchObject({ref: 'main'})
    expect(sourceWarnings(plugin)).toEqual([])
  })
  it('warns on an explicit branch', () => {
    expect(sourceWarnings(parse({type: 'git', url: 'u', branch: 'dev'}))[0]).toContain('"branch" is a deprecated alias')
  })
  it('fails with a named error when branch is written together with ref', () => {
    expect(() => parse({type: 'git', url: 'u', ref: 'main', branch: 'main'})).toThrow('PLUGIN_SOURCE_REF_CONFLICT')
  })
  it.each(['layout', 'include', 'exclude', 'map'])('fails with a named error for %s on a plugin source', (key) => {
    for (const source of [
      {type: 'local', path: 'p'},
      {type: 'git', url: 'u'},
    ])
      expect(() => parse({...source, [key]: key === 'layout' ? 'canonical' : ['x']})).toThrow('PLUGIN_SOURCE_REMAP')
  })
  it('rejects escaping package paths, option-like refs and duplicate names', () => {
    expect(() => parse({type: 'git', url: 'u', path: '../x'})).toThrow('relative path inside the repository')
    expect(() => parse({type: 'git', url: 'u', ref: '--upload-pack=x'})).toThrow('must not start with a dash')
    const twice = [
      {name: 'p', source: {type: 'local', path: 'a'}},
      {name: 'p', source: {type: 'local', path: 'b'}},
    ]
    expect(() => pluginsConfigSchema.parse(twice)).toThrow('Duplicate plugin name: p')
    expect(() => pluginsConfigSchema.parse([{name: '../p', source: {type: 'local', path: 'a'}}])).toThrow(
      'must be an Agent Plugins name',
    )
  })
  it('names short commit SHAs and unknown harnesses', () => {
    expect(() => parse({type: 'git', url: 'u', ref: 'a1b2c3d'})).toThrow('PLUGIN_SOURCE_SHORT_SHA')
    const harnesses = (ids: string[]) => () =>
      pluginsConfigSchema.parse([{name: 'p', source: {type: 'local', path: 'a'}, harnesses: ids}])
    expect(harnesses(['claude-code', 'droid'])).not.toThrow()
    expect(harnesses(['claud-code'])).toThrow('PLUGIN_UNKNOWN_HARNESS')
  })
  it('leaves loose-resource git sources and their branch default untouched', () => {
    const config = projectConfigSchema.parse({
      version: '1',
      assistants: [],
      sources: [{name: 's', type: 'git', url: 'u', layout: 'canonical'}],
      plugins: [{name: 'p', source: {type: 'git', url: 'u', ref: 'v1'}, scope: 'user'}],
    })
    expect(config.sources[0]).toMatchObject({branch: 'main', layout: 'canonical'})
    expect(config.plugins).toEqual([{name: 'p', source: {type: 'git', url: 'u', ref: 'v1'}, scope: 'user'}])
  })
})

describe('lockfile', () => {
  it('reads a missing lock as empty and refuses newer or malformed locks by name', async () => {
    expect(await readPluginLock(join(dir(), 'none.lock'))).toEqual({version: 1, plugins: [], variants: {}})
    expect(() => parsePluginLock('{"version":2,"plugins":[]}', 'forge.lock')).toThrow('upgrade forge')
    expect(() => parsePluginLock('{"version":1,"plugins":[{}],"variants":{}}', 'forge.lock')).toThrow(PluginLockError)
    expect(() => parsePluginLock('not json', 'forge.lock')).toThrow('not valid JSON')
    const entry = {
      name: 'p',
      version: '1.0.0',
      source: {type: 'local', path: 'p'},
      contentHash: '0'.repeat(64),
      outputs: {},
    }
    const lockOf = (...plugins: object[]) => JSON.stringify({version: 1, plugins, variants: {}})
    expect(parsePluginLock(lockOf(entry), 'forge.lock').plugins).toHaveLength(1)
    for (const bad of [
      {...entry, name: '../x'},
      {...entry, version: '../../x'},
    ])
      expect(() => parsePluginLock(lockOf(bad), 'forge.lock')).toThrow(PluginLockError)
    expect(() => parsePluginLock(lockOf(entry, entry), 'forge.lock')).toThrow('duplicate plugin name')
  })
})
