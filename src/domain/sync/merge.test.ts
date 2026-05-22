import {describe, expect, it} from 'bun:test'

import {SOURCE_CONFLICT_STRATEGIES} from '../config/types'
import {resolveSourceConflicts, SourceConflictError} from './merge'
import type {ResolvedTarget} from './types'

function target(targetPath: string, sourceName: string, content = 'content'): ResolvedTarget {
  return {sourcePath: `src/${targetPath}`, targetPath, content, assistantId: 'cursor', sourceName}
}

describe('resolveSourceConflicts', () => {
  describe('no conflicts', () => {
    it('returns all targets unchanged when no paths overlap', () => {
      const targets = [target('a.md', 'alpha'), target('b.md', 'beta')]
      const result = resolveSourceConflicts(targets, SOURCE_CONFLICT_STRATEGIES.LAST_WINS)
      expect(result).toHaveLength(2)
    })

    it('returns empty array for empty input', () => {
      expect(resolveSourceConflicts([], SOURCE_CONFLICT_STRATEGIES.LAST_WINS)).toEqual([])
    })
  })

  describe('last-wins', () => {
    it('keeps the last target when same path from different sources', () => {
      const targets = [
        target('.cursor/rules/style.mdc', 'alpha', 'first'),
        target('.cursor/rules/style.mdc', 'beta', 'second'),
      ]
      const result = resolveSourceConflicts(targets, SOURCE_CONFLICT_STRATEGIES.LAST_WINS)
      expect(result).toHaveLength(1)
      expect(result[0].sourceName).toBe('beta')
      expect(result[0].content).toBe('second')
    })

    it('keeps last among three sources', () => {
      const targets = [
        target('.cursor/rules/a.mdc', 'alpha', 'first'),
        target('.cursor/rules/a.mdc', 'beta', 'second'),
        target('.cursor/rules/a.mdc', 'gamma', 'third'),
      ]
      const result = resolveSourceConflicts(targets, SOURCE_CONFLICT_STRATEGIES.LAST_WINS)
      expect(result).toHaveLength(1)
      expect(result[0].sourceName).toBe('gamma')
    })

    it('deduplicates same-source same-path (keeps last)', () => {
      const targets = [target('.cursor/rules/a.mdc', 'alpha', 'v1'), target('.cursor/rules/a.mdc', 'alpha', 'v2')]
      const result = resolveSourceConflicts(targets, SOURCE_CONFLICT_STRATEGIES.LAST_WINS)
      expect(result).toHaveLength(1)
      expect(result[0].content).toBe('v2')
    })
  })

  describe('first-wins', () => {
    it('keeps the first target when same path from different sources', () => {
      const targets = [
        target('.cursor/rules/style.mdc', 'alpha', 'first'),
        target('.cursor/rules/style.mdc', 'beta', 'second'),
      ]
      const result = resolveSourceConflicts(targets, SOURCE_CONFLICT_STRATEGIES.FIRST_WINS)
      expect(result).toHaveLength(1)
      expect(result[0].sourceName).toBe('alpha')
      expect(result[0].content).toBe('first')
    })
  })

  describe('error', () => {
    it('throws SourceConflictError when same path from different sources', () => {
      const targets = [
        target('.cursor/rules/style.mdc', 'alpha', 'first'),
        target('.cursor/rules/style.mdc', 'beta', 'second'),
      ]
      expect(() => resolveSourceConflicts(targets, SOURCE_CONFLICT_STRATEGIES.ERROR)).toThrow(SourceConflictError)
    })

    it('includes all conflicting paths in the error', () => {
      const targets = [
        target('.cursor/rules/a.mdc', 'alpha'),
        target('.cursor/rules/a.mdc', 'beta'),
        target('.claude/skills/b.md', 'alpha'),
        target('.claude/skills/b.md', 'gamma'),
      ]
      try {
        resolveSourceConflicts(targets, SOURCE_CONFLICT_STRATEGIES.ERROR)
        expect.unreachable('should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(SourceConflictError)
        const e = err as SourceConflictError
        expect(e.conflicts).toHaveLength(2)
        expect(e.conflicts[0].sources).toEqual(['alpha', 'beta'])
        expect(e.conflicts[1].sources).toEqual(['alpha', 'gamma'])
      }
    })

    it('does not throw when same path from same source (not a cross-source conflict)', () => {
      const targets = [target('.cursor/rules/a.mdc', 'alpha', 'v1'), target('.cursor/rules/a.mdc', 'alpha', 'v2')]
      const result = resolveSourceConflicts(targets, SOURCE_CONFLICT_STRATEGIES.ERROR)
      expect(result).toHaveLength(1)
    })

    it('passes through non-conflicting targets', () => {
      const targets = [target('a.md', 'alpha'), target('b.md', 'beta')]
      const result = resolveSourceConflicts(targets, SOURCE_CONFLICT_STRATEGIES.ERROR)
      expect(result).toHaveLength(2)
    })
  })

  describe('preserves order', () => {
    it('maintains insertion order of non-conflicting targets', () => {
      const targets = [target('c.md', 'alpha'), target('a.md', 'alpha'), target('b.md', 'beta')]
      const result = resolveSourceConflicts(targets, SOURCE_CONFLICT_STRATEGIES.LAST_WINS)
      expect(result.map((t) => t.targetPath)).toEqual(['c.md', 'a.md', 'b.md'])
    })
  })
})
