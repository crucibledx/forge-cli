import './cline'
import './copilot'
import './windsurf'

import {describe, expect, it} from 'bun:test'

import {claudeCode} from './claude-code'
import {cursor} from './cursor'
import {
  getAllHarnesses,
  getHarness,
  getHarnessIds,
  resolveHarnessByPath,
  resolveHarnessBySettingsPath,
} from './registry'

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
  it('returns all 5 harnesses', () => {
    const all = getAllHarnesses()
    expect(all).toHaveLength(5)
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
