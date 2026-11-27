import {mkdir, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {describe, expect, it} from 'bun:test'

import {lockedSource, portabilityReport, sourceWarnings} from '@domain/plugins'
import {projectConfigSchema} from '@infrastructure/config/schema'
import {COVER_ALL_DIR, COVER_ALL_EXPECTED, PLUGIN_SCHEMA_ID, pluginManifest} from '@e2e/fixtures/plugin-packages'

import {
  checkManifest,
  checkMcpConfig,
  checkPluginDirectory,
  parsePluginLock,
  PluginLockError,
  pluginsConfigSchema,
  readPluginLock,
} from '.'
import {compareSemver} from './manifest'

const base = {$schema: PLUGIN_SCHEMA_ID, name: 'demo', version: '1.0.0'}
const MCP_SCHEMA_ID = 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json'
const PLUGIN_DATA = '$' + '{PLUGIN_DATA}'
const PLUGIN_ROOT = '$' + '{PLUGIN_ROOT}'

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
  it('validates JSON components in every layer, including ones both vendor folders override', async () => {
    const mcp = JSON.stringify({$schema: MCP_SCHEMA_ID, mcpServers: {}})
    const check = await checkPluginDirectory(
      await fixtureDir({
        'plugin.json': pluginManifest('demo', '1.0.0'),
        'mcp.json': '{',
        'dev.crucibledx.forge/mcp.json': JSON.stringify({mcpServers: {}}),
        'dev.crucibledx.forge/hooks/hooks.json': '{',
        'com.anthropic/mcp.json': mcp,
        'com.anthropic/hooks/hooks.json': '{}',
        'ai.factory/mcp.json': mcp,
        'ai.factory/hooks/hooks.json': '{}',
      }),
    )
    expect(check.pkg).toBeUndefined()
    const errors = check.errors.join('\n')
    expect(errors).toContain('mcp.json: not valid JSON')
    expect(errors).toContain('dev.crucibledx.forge/mcp.json: missing required field "$schema"')
    expect(errors).toContain('dev.crucibledx.forge/hooks/hooks.json: not valid JSON')
    expect(check.errors).toHaveLength(3)
  })
  it('fails a package whose MCP server command escapes the plugin root', async () => {
    const check = await checkPluginDirectory(
      await fixtureDir({
        'plugin.json': pluginManifest('demo', '1.0.0'),
        'mcp.json': JSON.stringify({$schema: MCP_SCHEMA_ID, mcpServers: {s: {type: 'stdio', command: '../outside'}}}),
      }),
    )
    expect(check.pkg).toBeUndefined()
    expect(check.errors).toEqual(['mcp.json/mcpServers/s/command: resolves outside the plugin root'])
  })
  it('orders prerelease identifiers per SemVer for minForgeVersion', () => {
    const ordered = [
      '1.0.0-alpha',
      '1.0.0-alpha.1',
      '1.0.0-alpha.beta',
      '1.0.0-beta',
      '1.0.0-beta.2',
      '1.0.0-beta.11',
      '1.0.0-rc.1',
      '1.0.0',
    ]
    for (let i = 1; i < ordered.length; i++) {
      expect(compareSemver(ordered[i - 1], ordered[i])).toBeLessThan(0)
      expect(compareSemver(ordered[i], ordered[i - 1])).toBeGreaterThan(0)
    }
    expect(compareSemver('1.0.0+build.1', '1.0.0')).toBe(0)
    const requires = (min: string) => ({...base, extensions: {'dev.crucibledx.forge': {minForgeVersion: min}}})
    expect(checkManifest(requires('0.8.0-beta.2'), '0.8.0-beta.1').errors.join('\n')).toContain('upgrade forge')
    expect(checkManifest(requires('0.8.0-beta.2'), '0.8.0-beta.10').errors).toEqual([])
  })
})

describe('Agent Plugins MCP semantics', () => {
  const mcp = (servers: Record<string, object>) =>
    checkMcpConfig('mcp.json', {$schema: MCP_SCHEMA_ID, mcpServers: servers})
  it('accepts plugin-relative and bare commands, contained cwd, https and loopback http URLs', () => {
    expect(
      mcp({
        a: {type: 'stdio', command: './bin/server', cwd: './data'},
        a2: {type: 'stdio', command: './bin/../bin/server', cwd: './a/../data'},
        b: {type: 'stdio', command: 'npx', args: ['x'], cwd: `${PLUGIN_DATA}/db`},
        c: {
          type: 'streamable-http',
          url: 'https://example.com/mcp',
          headers: {'X-Tenant': 'public', 'X-Note': 'a\tb c'},
        },
        d: {type: 'sse', url: 'http://127.0.0.1:8080/sse'},
        e: {type: 'streamable-http', url: 'http://localhost/mcp'},
        f: {type: 'streamable-http', url: 'http://[::1]:9000/mcp'},
      }),
    ).toEqual([])
  })
  it.each([
    [
      'a parent-relative command',
      {type: 'stdio', command: '../bin/server'},
      's/command: resolves outside the plugin root',
    ],
    ['a command escaping after ./', {type: 'stdio', command: './bin/../../x'}, 's/command: resolves outside'],
    ['a path command without ./', {type: 'stdio', command: 'bin/server'}, 's/command: must be a bare executable'],
    ['a shell command string', {type: 'stdio', command: 'npx server'}, 's/command: must be a single executable token'],
    [
      'a cwd escaping the plugin root',
      {type: 'stdio', command: 'node', cwd: './../../outside'},
      's/cwd: resolves outside the plugin root',
    ],
    [
      'a cwd escaping PLUGIN_DATA',
      {type: 'stdio', command: 'node', cwd: `${PLUGIN_DATA}/../x`},
      's/cwd: resolves outside',
    ],
    ['a non-loopback http URL', {type: 'streamable-http', url: 'http://example.com/mcp'}, 's/url: must use https'],
    ['a relative URL', {type: 'sse', url: '/mcp'}, 's/url: must be an absolute URL'],
    ['a URL with user info', {type: 'streamable-http', url: 'https://u:p@example.com/mcp'}, 'user information'],
    ['a URL with a fragment', {type: 'streamable-http', url: 'https://example.com/mcp#x'}, 'fragment'],
    ['a non-HTTP URL', {type: 'streamable-http', url: 'ftp://example.com/mcp'}, 'http or https'],
    [
      'a credential header',
      {type: 'sse', url: 'https://example.com', headers: {Authorization: 'Bearer x'}},
      'carries credentials',
    ],
    [
      'an invalid header name',
      {type: 'sse', url: 'https://example.com', headers: {'Bad Header': 'x'}},
      'not a valid HTTP header name',
    ],
    [
      'a header value with a line break',
      {type: 'sse', url: 'https://example.com', headers: {'X-A': 'a\r\nB: c'}},
      'not a valid HTTP field value',
    ],
    [
      'a command escaping after ./ with a doubled slash',
      {type: 'stdio', command: './/../outside'},
      's/command: resolves outside the plugin root',
    ],
    [
      'a cwd escaping after ./ with a doubled slash',
      {type: 'stdio', command: 'node', cwd: './/../outside'},
      's/cwd: resolves outside the plugin root',
    ],
    [
      'a cwd escaping PLUGIN_ROOT with a doubled slash',
      {type: 'stdio', command: 'node', cwd: `${PLUGIN_ROOT}//../outside`},
      `s/cwd: resolves outside ${PLUGIN_ROOT}`,
    ],
    [
      'a cwd escaping PLUGIN_DATA with a doubled slash',
      {type: 'stdio', command: 'node', cwd: `${PLUGIN_DATA}//../outside`},
      `s/cwd: resolves outside ${PLUGIN_DATA}`,
    ],
    [
      'a command that escapes and re-enters a directory named like the root',
      {type: 'stdio', command: './../root/outside'},
      's/command: resolves outside the plugin root',
    ],
    [
      'a cwd that escapes and re-enters a directory named like the root',
      {type: 'stdio', command: 'node', cwd: './../root/outside'},
      's/cwd: resolves outside the plugin root',
    ],
    [
      'a cwd that escapes PLUGIN_DATA and re-enters',
      {type: 'stdio', command: 'node', cwd: `${PLUGIN_DATA}/../root/outside`},
      `s/cwd: resolves outside ${PLUGIN_DATA}`,
    ],
    [
      'a cwd that climbs above PLUGIN_ROOT midway',
      {type: 'stdio', command: 'node', cwd: `${PLUGIN_ROOT}/a/../../plugin/x`},
      `s/cwd: resolves outside ${PLUGIN_ROOT}`,
    ],
    [
      'header names that differ only in case',
      {type: 'sse', url: 'https://example.com', headers: {'X-Tenant': 'a', 'x-tenant': 'b'}},
      's/headers/x-tenant: duplicates another header name',
    ],
    [
      'a header value with a control character',
      {type: 'sse', url: 'https://example.com', headers: {'X-A': 'a\u0001b'}},
      's/headers/X-A: value is not a valid HTTP field value',
    ],
    [
      'a header value with DEL',
      {type: 'sse', url: 'https://example.com', headers: {'X-A': 'a\u007fb'}},
      's/headers/X-A: value is not a valid HTTP field value',
    ],
    [
      'a header value with surrounding whitespace',
      {type: 'sse', url: 'https://example.com', headers: {'X-A': ' a'}},
      's/headers/X-A: value is not a valid HTTP field value',
    ],
  ])('rejects %s', (_, server, message) => {
    expect(mcp({s: server}).join('\n')).toContain(message)
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
      harnesses: [],
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
