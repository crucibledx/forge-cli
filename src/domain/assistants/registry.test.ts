import './cline'
import './copilot'
import './windsurf'

import {describe, expect, it} from 'bun:test'

import {claudeCode} from './claude-code'
import {cursor} from './cursor'
import {getAllAssistants, getAssistant, getAssistantIds} from './registry'

describe('getAllAssistants', () => {
  it('returns all 5 assistants', () => {
    const all = getAllAssistants()
    expect(all).toHaveLength(5)
  })

  it('covers every registered id', () => {
    const ids = getAllAssistants().map((a) => a.id)
    for (const id of getAssistantIds()) {
      expect(ids).toContain(id)
    }
  })

  it('each assistant has a non-empty name and targetMappings', () => {
    for (const a of getAllAssistants()) {
      expect(a.name.length).toBeGreaterThan(0)
      expect(a.targetMappings.length).toBeGreaterThan(0)
    }
  })
})

describe('getAssistant', () => {
  it('returns correct assistant by id', () => {
    const a = getAssistant(cursor.id)
    expect(a.id).toBe(cursor.id)
    expect(a.name).toBe(cursor.name)
  })

  it('throws for unknown id', () => {
    expect(() => getAssistant('unknown-tool')).toThrow('Unknown assistant: unknown-tool')
  })

  it('returns claude-code with expected mappings', () => {
    const a = getAssistant(claudeCode.id)
    const globs = a.targetMappings.map((m) => m.sourceGlob)
    expect(globs).toContain('skills/**')
    expect(globs).toContain('rules/**')
  })
})
