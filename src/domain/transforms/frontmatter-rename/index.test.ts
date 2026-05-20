import {describe, expect, it} from 'bun:test'

import type {TransformContext} from '../types'
import {frontmatterRenameTransformer} from './index'

const ctx = (content: string): TransformContext => ({filename: 'file.md', content})

describe('frontmatter-rename transformer', () => {
  it('has id "frontmatter-rename"', () => {
    expect(frontmatterRenameTransformer.id).toBe('frontmatter-rename')
  })

  it('renames paths to globs in frontmatter', () => {
    const result = frontmatterRenameTransformer.apply(ctx('---\npaths:\n  - "src/**"\n---\nBody text.'), {
      from: 'paths',
      to: 'globs',
    })
    expect(result.content).toContain('globs:')
    expect(result.content).not.toContain('paths:')
    expect(result.content).toContain('Body text.')
  })

  it('renames paths to applyTo in frontmatter', () => {
    const result = frontmatterRenameTransformer.apply(
      ctx('---\npaths:\n  - "src/api/**/*.ts"\n---\nAll endpoints must validate input.'),
      {from: 'paths', to: 'applyTo'},
    )
    expect(result.content).toContain('applyTo:')
    expect(result.content).not.toContain('paths:')
    expect(result.content).toContain('All endpoints must validate input.')
  })

  it('leaves content unchanged when no frontmatter', () => {
    const input = '# No any\nJust content.'
    expect(frontmatterRenameTransformer.apply(ctx(input), {from: 'paths', to: 'globs'}).content).toBe(input)
  })

  it('leaves content unchanged when frontmatter is not closed', () => {
    const input = '---\npaths:\n  - "src/**"'
    expect(frontmatterRenameTransformer.apply(ctx(input), {from: 'paths', to: 'globs'}).content).toBe(input)
  })

  it('leaves content unchanged when key is not found', () => {
    const input = '---\ntitle: Test\n---\nBody.'
    expect(frontmatterRenameTransformer.apply(ctx(input), {from: 'paths', to: 'globs'}).content).toBe(input)
  })

  it('returns content unchanged when from is missing', () => {
    const input = '---\npaths:\n  - "src/**"\n---\nBody.'
    expect(frontmatterRenameTransformer.apply(ctx(input), {to: 'globs'}).content).toBe(input)
  })

  it('returns content unchanged when to is missing', () => {
    const input = '---\npaths:\n  - "src/**"\n---\nBody.'
    expect(frontmatterRenameTransformer.apply(ctx(input), {from: 'paths'}).content).toBe(input)
  })

  it('does not rename keys in body, only frontmatter', () => {
    const input = '---\ntitle: Test\n---\npaths: something'
    expect(frontmatterRenameTransformer.apply(ctx(input), {from: 'paths', to: 'globs'}).content).toContain(
      'paths: something',
    )
  })

  it('preserves filename unchanged', () => {
    const input: TransformContext = {filename: 'rules/api.md', content: '---\npaths:\n---\nBody.'}
    expect(frontmatterRenameTransformer.apply(input, {from: 'paths', to: 'globs'}).filename).toBe('rules/api.md')
  })

  // ── Security ───────────────────────────────────────────────────────────

  it('rejects from containing newline (YAML injection)', () => {
    const input = '---\npaths:\n  - "src/**"\n---\nBody.'
    const result = frontmatterRenameTransformer.apply(ctx(input), {from: 'paths\nevil', to: 'globs'})
    expect(result.content).toBe(input)
  })

  it('rejects to containing newline (YAML injection)', () => {
    const input = '---\npaths:\n  - "src/**"\n---\nBody.'
    const result = frontmatterRenameTransformer.apply(ctx(input), {
      from: 'paths',
      to: 'globs\n  - "**/*"\ninjected',
    })
    expect(result.content).toBe(input)
  })

  it('handles regex special chars in from key safely', () => {
    const input = '---\npath[0]:\n  - "src/**"\n---\nBody.'
    const result = frontmatterRenameTransformer.apply(ctx(input), {from: 'path[0]', to: 'globs'})
    expect(result.content).toContain('globs:')
    expect(result.content).not.toContain('path[0]:')
  })
})
