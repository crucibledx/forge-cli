import './cline'
import './copilot'
import './windsurf'

import {describe, expect, it} from 'bun:test'

import {claudeCode} from './claude-code'
import {SOURCE_GLOB_KINDS} from './coverage'
import {cursor} from './cursor'
import {droid} from './droid'
import {COMPONENT_FORMATS} from './formats'
import {
  getAllHarnesses,
  getHarness,
  getHarnessIds,
  resolveHarnessByPath,
  resolveHarnessBySettingsPath,
} from './registry'
import type {HarnessDefinition, HarnessPluginCapability} from './types'
import {COMPONENT_KINDS} from './types'

it.each([
  ['.claude/settings.local.json', claudeCode.id],
  ['.claude/settings.json', claudeCode.id],
  ['settings.json', undefined],
])('BR-11 settings file %s is owned by the harness whose targets share its folder', (path, id) => {
  expect(resolveHarnessBySettingsPath(path)?.id).toBe(id)
})

it.each(['.CLAUDE\\SKILLS\\a.md', '.claude//skills///a.md'])(
  'AC-4,9 ownership uses the same portable folding as collision checks: %s',
  (path) => {
    expect(resolveHarnessByPath(path)?.id).toBe(claudeCode.id)
  },
)

describe('getAllHarnesses', () => {
  it('returns all 6 harnesses', () => {
    const all = getAllHarnesses()
    expect(all).toHaveLength(6)
  })

  it('covers every registered id', () => {
    const ids = getAllHarnesses().map((a) => a.id)
    for (const id of getHarnessIds()) {
      expect(ids).toContain(id)
    }
  })

  it('each harness has a non-empty name and targetMappings', () => {
    for (const a of getAllHarnesses()) {
      expect(a.name.length).toBeGreaterThan(0)
      expect(a.targetMappings.length).toBeGreaterThan(0)
    }
  })
})

describe('getHarness', () => {
  it('returns correct harness by id', () => {
    const a = getHarness(cursor.id)
    expect(a.id).toBe(cursor.id)
    expect(a.name).toBe(cursor.name)
  })

  it('throws for unknown id', () => {
    expect(() => getHarness('unknown-tool')).toThrow('Unknown harness: unknown-tool')
  })

  it('returns claude-code with expected mappings', () => {
    const a = getHarness(claudeCode.id)
    const globs = a.targetMappings.map((m) => m.sourceGlob)
    expect(globs).toContain('skills/**')
    expect(globs).toContain('rules/**')
  })
})

describe('AC-4 targetMappings match components', () => {
  it.each(getAllHarnesses().map((harness) => [harness.id, harness] as const))('%s', (_, harness) => {
    for (const mapping of harness.targetMappings) {
      const kind = SOURCE_GLOB_KINDS[mapping.sourceGlob]
      expect(kind).toBeDefined()
      const component = harness.components[kind]
      expect(component).toBeDefined()
      expect(component!.project).toBe(mapping.destination.project)
      expect(component!.global).toBe(`~/${mapping.destination.global ?? mapping.destination.project}`)
      expect(component!.transforms ?? []).toEqual(mapping.transforms ?? [])
    }
    for (const [glob, kind] of Object.entries(SOURCE_GLOB_KINDS)) {
      if (harness.components[kind]) expect(harness.targetMappings.map((m) => m.sourceGlob)).toContain(glob)
    }
  })

  it('every component uses a registered format and a known kind', () => {
    const formats: string[] = Object.values(COMPONENT_FORMATS)
    const kinds: string[] = Object.values(COMPONENT_KINDS)
    for (const harness of getAllHarnesses()) {
      for (const [kind, component] of Object.entries(harness.components)) {
        expect(kinds).toContain(kind)
        expect(formats).toContain(component.format)
        expect(component.project ?? component.global).toBeDefined()
        if (component.global) expect(component.global.startsWith('~/')).toBe(true)
      }
    }
  })
})

describe('AC-11 plugin capability', () => {
  it('is unset on every built-in', () => {
    for (const harness of getAllHarnesses()) expect(harness.plugin).toBeUndefined()
  })

  it('is an optional field of the definition type', () => {
    const plugin: HarnessPluginCapability = {emit: 'factory', register: 'droid-settings'}
    const withPlugin: HarnessDefinition = {...droid, plugin}
    expect(withPlugin.plugin).toEqual(plugin)
  })
})

describe('droid', () => {
  it('syncs skills and workflows to .factory and has no rules mapping', () => {
    expect(getHarness('droid').targetMappings).toEqual([
      {sourceGlob: 'skills/**', destination: {project: '.factory/skills/'}},
      {sourceGlob: 'workflows/**', destination: {project: '.factory/commands/'}},
    ])
    expect(droid.components.rule).toBeUndefined()
    expect(droid.detection.directories).toEqual(['.factory', '~/.factory'])
  })

  it('owns synced .factory paths', () => {
    expect(resolveHarnessByPath('.factory/skills/a/SKILL.md')?.id).toBe('droid')
    expect(resolveHarnessByPath('.factory/commands/review.md')?.id).toBe('droid')
  })
})
