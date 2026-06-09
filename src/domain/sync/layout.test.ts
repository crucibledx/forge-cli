import '../assistants/claude-code'
import '../assistants/cursor'
import '../assistants/windsurf'
import '../assistants/copilot'
import '../assistants/cline'

import {describe, expect, it} from 'bun:test'

import {detectSourceLayout, partitionByLayout, SOURCE_LAYOUTS} from './layout'
import type {SourceFile} from './types'

function files(...paths: string[]): SourceFile[] {
  return paths.map((p) => ({relativePath: p, content: `content of ${p}`}))
}

describe('detectSourceLayout', () => {
  it('returns canonical for standard layout', () => {
    expect(detectSourceLayout(files('rules/api.md', 'skills/deploy.md'))).toBe(SOURCE_LAYOUTS.CANONICAL)
  })

  it('returns pre-structured when .claude/ found', () => {
    expect(detectSourceLayout(files('.claude/rules/api.md'))).toBe(SOURCE_LAYOUTS.PRE_STRUCTURED)
  })

  it('returns pre-structured when .cursor/ found', () => {
    expect(detectSourceLayout(files('.cursor/rules/api.mdc'))).toBe(SOURCE_LAYOUTS.PRE_STRUCTURED)
  })

  it('returns pre-structured when .windsurf/ found', () => {
    expect(detectSourceLayout(files('.windsurf/rules/api.md'))).toBe(SOURCE_LAYOUTS.PRE_STRUCTURED)
  })

  it('returns pre-structured when .github/ found', () => {
    expect(detectSourceLayout(files('.github/instructions/api.instructions.md'))).toBe(SOURCE_LAYOUTS.PRE_STRUCTURED)
  })

  it('returns pre-structured when .cline/ found', () => {
    expect(detectSourceLayout(files('.clinerules/api.md'))).toBe(SOURCE_LAYOUTS.PRE_STRUCTURED)
  })

  it('returns canonical for empty file list', () => {
    expect(detectSourceLayout([])).toBe(SOURCE_LAYOUTS.CANONICAL)
  })

  it('returns hybrid when both assistant dirs and canonical files present', () => {
    expect(detectSourceLayout(files('rules/api.md', '.claude/rules/api.md'))).toBe(SOURCE_LAYOUTS.HYBRID)
  })

  it('returns pre-structured when only assistant dirs present', () => {
    expect(detectSourceLayout(files('.claude/rules/api.md', '.cursor/rules/api.mdc'))).toBe(
      SOURCE_LAYOUTS.PRE_STRUCTURED,
    )
  })
})

describe('partitionByLayout', () => {
  it('separates pre-structured and canonical files', () => {
    const result = partitionByLayout(files('rules/api.md', '.claude/rules/api.md', 'skills/deploy.md'))
    expect(result.preStructured).toHaveLength(1)
    expect(result.preStructured[0].relativePath).toBe('.claude/rules/api.md')
    expect(result.canonical).toHaveLength(2)
  })

  it('returns all canonical when no assistant dirs', () => {
    const result = partitionByLayout(files('rules/api.md', 'skills/deploy.md'))
    expect(result.preStructured).toHaveLength(0)
    expect(result.canonical).toHaveLength(2)
  })

  it('returns all pre-structured when only assistant dirs', () => {
    const result = partitionByLayout(files('.claude/rules/api.md', '.cursor/rules/api.mdc'))
    expect(result.preStructured).toHaveLength(2)
    expect(result.canonical).toHaveLength(0)
  })
})
