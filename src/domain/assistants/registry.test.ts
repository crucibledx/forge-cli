import {describe, expect, it} from 'bun:test'
import {map} from 'lodash-es'

import {claudeCode} from './claude-code'
import {cursor} from './cursor'
import {getAllAssistants, getAssistant} from './registry'
import {ASSISTANT_IDS} from './types'

describe('getAllAssistants', () => {
  it('returns all 5 assistants', () => {
    const all = getAllAssistants()
    expect(all).toHaveLength(5)
  })

  it('covers every AssistantId', () => {
    const ids = map(getAllAssistants(), (a) => a.id)
    for (const id of ASSISTANT_IDS) {
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
    // @ts-expect-error testing invalid input
    expect(() => getAssistant('unknown-tool')).toThrow('Unknown assistant: unknown-tool')
  })

  it('returns claude-code with expected mappings', () => {
    const a = getAssistant(claudeCode.id)
    const globs = map(a.targetMappings, (m) => m.sourceGlob)
    expect(globs).toContain('skills/**')
    expect(globs).toContain('rules/**')
  })
})
