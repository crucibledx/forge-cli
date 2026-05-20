import {describe, expect, it} from 'bun:test'

import type {TransformContext} from '../types'
import {renameTransformer} from './index'

const ctx = (filename: string): TransformContext => ({filename, content: ''})

describe('rename transformer', () => {
  it('has id "rename"', () => {
    expect(renameTransformer.id).toBe('rename')
  })

  it('renames .md to .mdc', () => {
    expect(renameTransformer.apply(ctx('no-any.md'), {from: '.md', to: '.mdc'}).filename).toBe('no-any.mdc')
  })

  it('renames .md to .instructions.md', () => {
    expect(renameTransformer.apply(ctx('api.md'), {from: '.md', to: '.instructions.md'}).filename).toBe(
      'api.instructions.md',
    )
  })

  it('returns filename unchanged when suffix does not match', () => {
    expect(renameTransformer.apply(ctx('readme.txt'), {from: '.md', to: '.mdc'}).filename).toBe('readme.txt')
  })

  it('returns filename unchanged when from is missing', () => {
    expect(renameTransformer.apply(ctx('file.md'), {to: '.mdc'}).filename).toBe('file.md')
  })

  it('returns filename unchanged when to is missing', () => {
    expect(renameTransformer.apply(ctx('file.md'), {from: '.md'}).filename).toBe('file.md')
  })

  it('handles empty string replacement (strip extension)', () => {
    expect(renameTransformer.apply(ctx('file.md'), {from: '.md', to: ''}).filename).toBe('file')
  })

  it('preserves content unchanged', () => {
    const input: TransformContext = {filename: 'file.md', content: '# Hello'}
    expect(renameTransformer.apply(input, {from: '.md', to: '.mdc'}).content).toBe('# Hello')
  })

  // ── Security & edge cases ──────────────────────────────────────────────

  it('rejects from containing path separator', () => {
    expect(renameTransformer.apply(ctx('file.md'), {from: '../.md', to: '.mdc'}).filename).toBe('file.md')
  })

  it('rejects to containing path separator', () => {
    expect(renameTransformer.apply(ctx('file.md'), {from: '.md', to: '/../evil'}).filename).toBe('file.md')
  })

  it('rejects backslash path separator', () => {
    expect(renameTransformer.apply(ctx('file.md'), {from: '.md', to: '\\evil'}).filename).toBe('file.md')
  })

  // ── Double-suffix behavior (documents current design) ─────────────────

  it('applies suffix replacement even when target suffix already present', () => {
    // "my-skill.instructions.md" + {from: '.md', to: '.instructions.md'}
    // → replaces trailing ".md" with ".instructions.md"
    expect(
      renameTransformer.apply(ctx('my-skill.instructions.md'), {from: '.md', to: '.instructions.md'}).filename,
    ).toBe('my-skill.instructions.instructions.md')
  })
})
