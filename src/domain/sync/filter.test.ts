import {describe, expect, test} from 'bun:test'

import type {Source} from '../config/types'
import {applySourceFilters, filterExclude, filterInclude, mapSourceFiles} from './filter'
import type {SourceFile} from './types'

function file(relativePath: string, content = ''): SourceFile {
  return {relativePath, content}
}

function source(overrides: Partial<Source> = {}): Source {
  return {name: 'test', type: 'local', ...overrides}
}

describe('filterInclude', () => {
  const files = [
    file('skill-cli/drawio/SKILL.md'),
    file('mcp-app-server/index.ts'),
    file('shared/utils.ts'),
    file('README.md'),
  ]

  test('keeps files matching a single pattern', () => {
    const result = filterInclude(files, ['skill-cli/**'])
    expect(result).toEqual([file('skill-cli/drawio/SKILL.md')])
  })

  test('keeps files matching any of multiple patterns', () => {
    const result = filterInclude(files, ['skill-cli/**', '*.md'])
    expect(result).toEqual([file('skill-cli/drawio/SKILL.md'), file('README.md')])
  })

  test('returns empty when nothing matches', () => {
    const result = filterInclude(files, ['nonexistent/**'])
    expect(result).toEqual([])
  })

  test('supports exact filename matching', () => {
    const result = filterInclude(files, ['README.md'])
    expect(result).toEqual([file('README.md')])
  })

  test('supports deep glob matching', () => {
    const result = filterInclude(files, ['**/*.ts'])
    expect(result).toEqual([file('mcp-app-server/index.ts'), file('shared/utils.ts')])
  })
})

describe('filterExclude', () => {
  const files = [
    file('skills/deploy.md'),
    file('skills/testing.md'),
    file('.claude/rules/internal.md'),
    file('.cursor/rules/internal.mdc'),
    file('README.md'),
  ]

  test('removes files matching exclude pattern', () => {
    const result = filterExclude(files, ['.claude/**', '.cursor/**'])
    expect(result).toEqual([file('skills/deploy.md'), file('skills/testing.md'), file('README.md')])
  })

  test('removes nothing when no pattern matches', () => {
    const result = filterExclude(files, ['nonexistent/**'])
    expect(result).toEqual(files)
  })

  test('supports wildcard filename patterns', () => {
    const result = filterExclude(files, ['**/*.mdc'])
    expect(result).toEqual([
      file('skills/deploy.md'),
      file('skills/testing.md'),
      file('.claude/rules/internal.md'),
      file('README.md'),
    ])
  })
})

describe('mapSourceFiles', () => {
  test('prepends prefix to all file paths', () => {
    const files = [file('SKILL.md', '# Deploy'), file('README.md', '# Docs')]
    const result = mapSourceFiles(files, 'skills')
    expect(result).toEqual([
      {relativePath: 'skills/SKILL.md', content: '# Deploy'},
      {relativePath: 'skills/README.md', content: '# Docs'},
    ])
  })

  test('normalizes trailing slash in prefix', () => {
    const files = [file('SKILL.md')]
    const withSlash = mapSourceFiles(files, 'skills/')
    const withoutSlash = mapSourceFiles(files, 'skills')
    expect(withSlash).toEqual(withoutSlash)
  })

  test('preserves nested paths', () => {
    const files = [file('drawio/SKILL.md')]
    const result = mapSourceFiles(files, 'skills')
    expect(result).toEqual([{relativePath: 'skills/drawio/SKILL.md', content: ''}])
  })
})

describe('applySourceFilters', () => {
  const files = [
    file('skill-cli/drawio/SKILL.md', '# Draw.io'),
    file('mcp-app-server/index.ts', 'code'),
    file('README.md', '# Readme'),
  ]

  test('returns all files when no filters configured', () => {
    const result = applySourceFilters(files, source())
    expect(result).toEqual(files)
  })

  test('applies include then exclude then map in order', () => {
    const result = applySourceFilters(
      files,
      source({
        include: ['skill-cli/**', 'README.md'],
        exclude: ['README.md'],
        map: 'skills',
      }),
    )
    expect(result).toEqual([{relativePath: 'skills/skill-cli/drawio/SKILL.md', content: '# Draw.io'}])
  })

  test('include-only narrows files', () => {
    const result = applySourceFilters(files, source({include: ['skill-cli/**']}))
    expect(result).toEqual([file('skill-cli/drawio/SKILL.md', '# Draw.io')])
  })

  test('exclude-only removes files', () => {
    const result = applySourceFilters(files, source({exclude: ['**/*.ts']}))
    expect(result).toEqual([file('skill-cli/drawio/SKILL.md', '# Draw.io'), file('README.md', '# Readme')])
  })

  test('map-only prepends prefix', () => {
    const single = [file('SKILL.md', '# Skill')]
    const result = applySourceFilters(single, source({map: 'skills'}))
    expect(result).toEqual([{relativePath: 'skills/SKILL.md', content: '# Skill'}])
  })

  test('drawio-mcp use case: include + map', () => {
    const result = applySourceFilters(
      files,
      source({
        include: ['skill-cli/drawio/SKILL.md'],
        map: 'skills',
      }),
    )
    expect(result).toEqual([{relativePath: 'skills/skill-cli/drawio/SKILL.md', content: '# Draw.io'}])
  })
})
