import {readFileSync} from 'node:fs'
import {join} from 'node:path'

import {describe, expect, it} from 'bun:test'

import {COMPILE_CONFIG_DEFAULTS, effectiveCompileConfig} from '../config/types'
import type {PluginComponent, PluginPackage} from '../plugins/types'
import {canonicalDocument, canonicalJson} from './canonical'
import {compile} from './compile'
import {goldenGuardDocument, goldenManifestDocument} from './golden-fixture'
import {COMPILE_SUPPORT} from './harness-data'
import {COMPILE_INPUT_PARTS, compileInputs} from './inputs'
import {linkComponents} from './link'
import {compileManifestDocument, serializeCompileManifest} from './manifest'
import {DIAGNOSTIC_CODES} from './types'
import {applyEmittedVersion, COMPILER_VERSION, emittedVersion, versionSuffix} from './version'

const enc = (text: string) => new TextEncoder().encode(text)
const dec = (bytes: Uint8Array) => new TextDecoder().decode(bytes)

const component = (
  kind: PluginComponent['kind'],
  name: string,
  text: string,
  path = `${kind}s/${name}.md`,
): PluginComponent => ({
  kind,
  name,
  origin: '',
  root: path,
  files: [{path, content: enc(text)}],
})

const pkg = (name: string, version: string, components: PluginComponent[]): PluginPackage => ({
  manifest: {name, version, forge: {}},
  files: components.flatMap((entry) => entry.files),
  components: {droid: components, 'claude-code': []},
  warnings: [],
})

describe('canonical JSON (spec 0005 §5)', () => {
  it('sorts object keys at every depth and drops undefined', () => {
    expect(canonicalJson({b: 1, a: {d: [3, {z: 1, y: 2}], c: undefined}})).toBe('{"a":{"d":[3,{"y":2,"z":1}]},"b":1}')
    expect(canonicalDocument({b: 1})).toBe('{"b":1}\n')
  })
})

describe('emitted version (spec 0005 §5)', () => {
  it('build style appends to build metadata and keeps precedence', () => {
    expect(emittedVersion('1.2.3', 'deadbee5', 'build')).toBe('1.2.3+c.deadbee5')
    expect(emittedVersion('1.2.3+vendor.1', 'deadbee5', 'build')).toBe('1.2.3+vendor.1.c.deadbee5')
    expect(emittedVersion('1.2.3-rc.1', 'deadbee5', 'build')).toBe('1.2.3-rc.1+c.deadbee5')
  })

  it('prerelease style appends to the prerelease and keeps source build metadata', () => {
    expect(emittedVersion('1.2.3', 'deadbee5', 'prerelease')).toBe('1.2.3-c.deadbee5')
    expect(emittedVersion('1.2.3-rc.1+vendor.1', 'deadbee5', 'prerelease')).toBe('1.2.3-rc.1.c.deadbee5+vendor.1')
  })

  it('refuses a non-SemVer source version', () => {
    expect(() => emittedVersion('one', 'deadbee5', 'build')).toThrow('non-SemVer')
  })

  it('takes the first 8 hex of a hash as the suffix', () => {
    expect(versionSuffix('0123456789abcdef')).toBe('01234567')
  })

  it('stamps only the canonical manifest of a delivered tree', () => {
    const files = [
      {path: '.claude-plugin/plugin.json', content: enc('{\n  "name": "hello",\n  "version": "1.0.0"\n}\n')},
      {path: 'skills/hello/SKILL.md', content: enc('Hello\n')},
    ]
    const stamped = applyEmittedVersion(files, '1.0.0+c.deadbee5')
    expect(JSON.parse(dec(stamped[0].content))).toEqual({name: 'hello', version: '1.0.0+c.deadbee5'})
    expect(stamped[1]).toBe(files[1])
  })
})

describe('compile inputs (spec 0005 §5)', () => {
  const plugins = [
    {name: 'zeta', contentHash: 'z'.repeat(64)},
    {name: 'alpha', contentHash: 'a'.repeat(64)},
  ]
  const inputs = (over: Parameters<typeof compileInputs>[0]) => compileInputs(over)

  it('is a sha256 over the canonical parts and keeps the per-part hashes', () => {
    const result = inputs({
      config: COMPILE_CONFIG_DEFAULTS,
      harnessData: COMPILE_SUPPORT.droid,
      compilerVersion: 1,
      plugins,
    })
    expect(result.hash).toMatch(/^sha256:[a-f0-9]{64}$/)
    expect(Object.keys(result.parts).sort()).toEqual(
      [COMPILE_INPUT_PARTS.COMPILER, COMPILE_INPUT_PARTS.CONFIG, COMPILE_INPUT_PARTS.PLUGINS].sort(),
    )
  })

  it('is stable under plugin order, but changes with the config, compiler or plugin set', () => {
    const base = {config: COMPILE_CONFIG_DEFAULTS, harnessData: COMPILE_SUPPORT.droid, compilerVersion: 1}
    const a = inputs({...base, plugins})
    expect(inputs({...base, plugins: [...plugins].reverse()}).hash).toBe(a.hash)
    expect(inputs({...base, compilerVersion: 2, plugins}).hash).not.toBe(a.hash)
    expect(inputs({...base, plugins: plugins.slice(1)}).hash).not.toBe(a.hash)
    const config = effectiveCompileConfig({defer: ['x']})
    expect(inputs({config, harnessData: COMPILE_SUPPORT.droid, compilerVersion: 1, plugins}).hash).not.toBe(a.hash)
    // The config part is the one that moved.
    expect(inputs({config, harnessData: COMPILE_SUPPORT.droid, compilerVersion: 1, plugins}).parts.plugins).toBe(
      a.parts.plugins,
    )
  })

  it('hashes the detected profile tags when a profile is set, order-insensitively', () => {
    const base = {harnessData: COMPILE_SUPPORT.droid, compilerVersion: 1, plugins}
    const profile = effectiveCompileConfig({profile: 'rank'})
    const tagged = inputs({...base, config: profile, profileTags: ['typescript', 'react']})
    expect(inputs({...base, config: profile, profileTags: ['react', 'typescript']}).hash).toBe(tagged.hash)
    expect(inputs({...base, config: profile, profileTags: ['typescript']}).hash).not.toBe(tagged.hash)
    // Without a profile the tags never enter the hash.
    expect(inputs({...base, config: COMPILE_CONFIG_DEFAULTS, profileTags: ['react']}).hash).toBe(
      inputs({...base, config: COMPILE_CONFIG_DEFAULTS}).hash,
    )
  })
})

describe('link pass (spec 0005 §3)', () => {
  const setupAgent = component(
    'agent',
    'setup',
    '---\nname: setup\ndescription: Set up.\n---\n\nSetup.\n',
    'agents/setup.md',
  )

  it('links requires (array or string), subagent_type and explicit /<name> mentions inside the unit', () => {
    const skill = component(
      'skill',
      'deploy',
      '---\nname: deploy\ndescription: Deploy.\nrequires: [setup]\n---\n\nAlso run /setup and subagent_type: setup.\n',
      'skills/deploy/SKILL.md',
    )
    const caller = component('command', 'go', '---\nname: go\nrequires: setup\n---\n', 'commands/go.md')
    const linked = linkComponents([pkg('p', '1.0.0', [skill, caller, setupAgent])], 'droid')
    const byId = new Map(linked.map((entry) => [entry.id, entry]))
    expect(byId.get('p/skill/deploy')?.deps).toEqual(['p/agent/setup'])
    expect(byId.get('p/command/go')?.deps).toEqual(['p/agent/setup'])
    expect(byId.get('p/agent/setup')?.deps).toEqual([])
    expect(linked.every((entry) => entry.diagnostics.length === 0)).toBe(true)
  })

  it('warns on an unresolved requires or subagent_type, but a /<name> miss is prose', () => {
    const skill = component(
      'skill',
      'deploy',
      '---\nname: deploy\nrequires: [missing]\n---\n\nDelegates to subagent_type: ghost and mentions /nothing-here.\n',
      'skills/deploy/SKILL.md',
    )
    const [linked] = linkComponents([pkg('p', '1.0.0', [skill])], 'droid')
    expect(linked.deps).toEqual([])
    expect(linked.diagnostics.map((entry) => entry.code)).toEqual([
      DIAGNOSTIC_CODES.LINK_UNRESOLVED,
      DIAGNOSTIC_CODES.LINK_UNRESOLVED,
    ])
    expect(linked.diagnostics.every((entry) => entry.severity === 'warning')).toBe(true)
    expect(linked.diagnostics.map((entry) => entry.message).join(' ')).not.toContain('nothing-here')
  })

  it('links across packages of the unit; a shared name resolves to the smallest component id in any config order', () => {
    const a = pkg('a', '1.0.0', [component('agent', 'shared', '---\nname: shared\n---\n', 'agents/shared.md')])
    const b = pkg('b', '1.0.0', [
      component('agent', 'shared', '---\nname: shared\n---\n', 'agents/shared.md'),
      component('skill', 'use', '---\nname: use\nrequires: [shared]\n---\n', 'skills/use/SKILL.md'),
    ])
    // Deterministic: the edge lands on the smallest component id regardless of package order.
    for (const order of [
      [a, b],
      [b, a],
    ]) {
      const linked = linkComponents(order, 'droid')
      const use = linked.find((entry) => entry.id === 'b/skill/use')
      expect(use?.deps).toEqual(['a/agent/shared'])
    }
  })

  it('resolves subagent_type against agents only, while requires may target any named kind', () => {
    const agentSetup = component('agent', 'setup', '---\nname: setup\n---\n', 'agents/setup.md')
    const skillSetup = component('skill', 'setup', '---\nname: setup\n---\n', 'skills/setup/SKILL.md')
    const delegating = component('command', 'go', '---\nname: go\n---\n\nRun subagent_type: setup.\n', 'commands/go.md')
    const linked = linkComponents([pkg('p', '1.0.0', [skillSetup, agentSetup, delegating])], 'droid')
    // The skill shares the name but is not a delegation target: the edge lands on the agent.
    expect(linked.find((entry) => entry.id === 'p/command/go')?.deps).toEqual(['p/agent/setup'])

    const helper = component('skill', 'helper', '---\nname: helper\n---\n', 'skills/helper/SKILL.md')
    const needing = component('command', 'need', '---\nname: need\nrequires: [helper]\n---\n', 'commands/need.md')
    const required = linkComponents([pkg('p', '1.0.0', [helper, needing])], 'droid')
    expect(required.find((entry) => entry.id === 'p/command/need')?.deps).toEqual(['p/skill/helper'])
  })
})

describe('compile unit (spec 0005 §1)', () => {
  it('lists every component of the unit, changed: false for every package, sorted by id', () => {
    const setup = component('agent', 'setup', '---\nname: setup\n---\n', 'agents/setup.md')
    const packages = [
      pkg('b', '1.0.0', [component('skill', 'two', '---\nname: two\n---\n'), setup]),
      pkg('a', '1.0.0', [component('command', 'one', '---\nname: one\n---\n')]),
    ]
    const result = compile({packages, harness: 'droid', scope: 'project', config: COMPILE_CONFIG_DEFAULTS})
    expect(result.packages.map((entry) => entry.changed)).toEqual([false, false])
    expect(result.components.map((entry) => entry.id)).toEqual(['a/command/one', 'b/agent/setup', 'b/skill/two'])
    expect(
      result.components.every(
        (entry) => entry.status === 'listed' && entry.reasons.length === 0 && entry.cost === null,
      ),
    ).toBe(true)
    expect(result.links['b/skill/two']).toEqual([])
  })
})

describe('compile manifest (spec 0005 §2)', () => {
  it('serializes canonical JSON with a trailing newline and no timestamps', () => {
    const manifest = compileManifestDocument({
      harness: 'droid',
      scope: 'project',
      enabled: true,
      compiler: 1,
      inputs: 'sha256:' + '0'.repeat(64),
      components: [],
      variant: 'sha256:' + '1'.repeat(64),
    })
    const text = serializeCompileManifest(manifest)
    expect(text.endsWith('\n')).toBe(true)
    expect(text).not.toMatch(/time|date/i)
    expect(Object.keys(JSON.parse(text))).toEqual([...Object.keys(JSON.parse(text))].sort())
    expect(manifest.budget).toBeNull()
    expect(manifest.profile).toBeNull()
    expect(manifest.schema).toBe(1)
  })
})

describe('COMPILER_VERSION guard (spec 0005 §5)', () => {
  it('matches the golden for the current compiler version', () => {
    const goldenPath = join(import.meta.dir, 'golden', `compiler-${COMPILER_VERSION}.json`)
    let golden: string
    try {
      golden = readFileSync(goldenPath, 'utf8')
    } catch {
      throw new Error(
        `No golden for compiler ${COMPILER_VERSION}: regenerate with \`bun scripts/gen-compile-golden.ts\` and review the diff`,
      )
    }
    const actual = canonicalDocument(goldenGuardDocument())
    if (actual !== golden)
      throw new Error(
        'Compile output changed without a COMPILER_VERSION bump: bump COMPILER_VERSION in src/domain/compile/version.ts, ' +
          'regenerate with `bun scripts/gen-compile-golden.ts` and review the golden diff',
      )
  })
})

describe('manifest schema (AC-5)', () => {
  it('the manifest a compile produces validates against docs/schemas/compile-manifest.v1.json', async () => {
    const {default: Ajv} = await import('ajv/dist/2020')
    const schema = JSON.parse(
      readFileSync(join(import.meta.dir, '..', '..', '..', 'docs', 'schemas', 'compile-manifest.v1.json'), 'utf8'),
    )
    const validate = new Ajv({strict: false}).compile(schema)
    const manifest = JSON.parse(serializeCompileManifest(goldenManifestDocument()))
    expect(validate(manifest)).toBe(true)
    // And the closed diagnostic table in the schema matches the domain's.
    const codes = schema.properties.components.items.properties.diagnostics.items.properties.code.enum
    expect(codes).toEqual(Object.values(DIAGNOSTIC_CODES))
  })
})
