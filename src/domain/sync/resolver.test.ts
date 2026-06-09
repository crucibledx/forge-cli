import '../assistants/claude-code'
import '../assistants/cursor'
import '../assistants/windsurf'
import '../assistants/copilot'
import '../assistants/cline'
import '../transforms/frontmatter-rename'
import '../transforms/rename'

import {describe, expect, it} from 'bun:test'

import type {AssistantDefinition} from '../assistants/types'
import {resolveTargets} from './resolver'
import type {SourceFile} from './types'

const cursorDef: AssistantDefinition = {
  id: 'cursor',
  name: 'Cursor',
  detection: {directories: ['.cursor'], files: []},
  targetMappings: [
    {sourceGlob: 'skills/**', destination: '.cursor/skills/'},
    {
      sourceGlob: 'rules/**',
      destination: '.cursor/rules/',
      transforms: [
        {transformer: 'rename', params: {from: '.md', to: '.mdc'}},
        {transformer: 'frontmatter-rename', params: {from: 'paths', to: 'globs'}},
      ],
    },
    {sourceGlob: 'workflows/**', destination: '.cursor/commands/'},
  ],
}

const claudeDef: AssistantDefinition = {
  id: 'claude-code',
  name: 'Claude Code',
  detection: {directories: ['.claude'], files: []},
  targetMappings: [
    {sourceGlob: 'skills/**', destination: '.claude/skills/'},
    {sourceGlob: 'rules/**', destination: '.claude/rules/'},
  ],
}

const windsurfDef: AssistantDefinition = {
  id: 'windsurf',
  name: 'Windsurf',
  detection: {directories: ['.windsurf'], files: []},
  targetMappings: [
    {sourceGlob: 'skills/**', destination: '.windsurf/skills/'},
    {sourceGlob: 'rules/**', destination: '.windsurf/rules/'},
  ],
}

const sourceFiles: SourceFile[] = [
  {relativePath: 'skills/typescript.md', content: '# TS skill'},
  {relativePath: 'rules/no-any.md', content: '# No any'},
  {relativePath: 'workflows/deploy.md', content: '# Deploy'},
  {relativePath: 'unrelated/file.txt', content: 'ignored'},
]

describe('resolveTargets', () => {
  it('returns empty array when no source files', () => {
    const result = resolveTargets([], [cursorDef])
    expect(result).toHaveLength(0)
  })

  it('returns empty array when no assistants', () => {
    const result = resolveTargets(sourceFiles, [])
    expect(result).toHaveLength(0)
  })

  it('resolves skills for cursor without transform', () => {
    const result = resolveTargets(sourceFiles, [cursorDef])
    const skill = result.find((r) => r.sourcePath === 'skills/typescript.md')
    expect(skill).toBeDefined()
    expect(skill!.targetPath).toBe('.cursor/skills/typescript.md')
    expect(skill!.assistantId).toBe('cursor')
  })

  it('applies rename transform for cursor rules (.md → .mdc)', () => {
    const result = resolveTargets(sourceFiles, [cursorDef])
    const rule = result.find((r) => r.sourcePath === 'rules/no-any.md')
    expect(rule).toBeDefined()
    expect(rule!.targetPath).toBe('.cursor/rules/no-any.mdc')
  })

  it('resolves workflows for cursor without transform', () => {
    const result = resolveTargets(sourceFiles, [cursorDef])
    const wf = result.find((r) => r.sourcePath === 'workflows/deploy.md')
    expect(wf!.targetPath).toBe('.cursor/commands/deploy.md')
  })

  it('does not match unrelated files', () => {
    const result = resolveTargets(sourceFiles, [cursorDef])
    const unrelated = result.find((r) => r.sourcePath === 'unrelated/file.txt')
    expect(unrelated).toBeUndefined()
  })

  it('resolves files for multiple assistants', () => {
    const result = resolveTargets(sourceFiles, [cursorDef, claudeDef])
    const cursorSkills = result.filter((r) => r.assistantId === 'cursor' && r.sourcePath === 'skills/typescript.md')
    const claudeSkills = result.filter(
      (r) => r.assistantId === 'claude-code' && r.sourcePath === 'skills/typescript.md',
    )
    expect(cursorSkills).toHaveLength(1)
    expect(claudeSkills).toHaveLength(1)
  })

  it('carries source file content to resolved target', () => {
    const result = resolveTargets(sourceFiles, [claudeDef])
    const rule = result.find((r) => r.sourcePath === 'rules/no-any.md')
    expect(rule!.content).toBe('# No any')
  })

  it('carries sourceName through to resolved targets', () => {
    const result = resolveTargets(sourceFiles, [claudeDef], 'team-rules')
    expect(result.every((r) => r.sourceName === 'team-rules')).toBe(true)
  })

  it('defaults sourceName to empty string when omitted', () => {
    const result = resolveTargets(sourceFiles, [claudeDef])
    expect(result.every((r) => r.sourceName === '')).toBe(true)
  })

  it('ignores unknown transformer id gracefully (returns filename unchanged)', () => {
    const defWithBadTransform: AssistantDefinition = {
      ...cursorDef,
      targetMappings: [
        {
          sourceGlob: 'skills/**',
          destination: '.cursor/skills/',
          transforms: [{transformer: 'unknown', params: {from: 'foo', to: 'bar'}}],
        },
      ],
    }
    const result = resolveTargets(sourceFiles, [defWithBadTransform])
    const skill = result.find((r) => r.sourcePath === 'skills/typescript.md')
    expect(skill!.targetPath).toBe('.cursor/skills/typescript.md')
  })

  // ── Content transforms (frontmatter) ─────────────────────────────────

  it('renames paths to globs in frontmatter for cursor rules', () => {
    const ruleWithFrontmatter: SourceFile[] = [
      {
        relativePath: 'rules/api.md',
        content: '---\npaths:\n  - "src/api/**/*.ts"\n---\nAll endpoints must validate input.',
      },
    ]
    const result = resolveTargets(ruleWithFrontmatter, [cursorDef])
    const rule = result.find((r) => r.sourcePath === 'rules/api.md')!
    expect(rule.content).toContain('globs:')
    expect(rule.content).not.toContain('paths:')
    expect(rule.content).toContain('All endpoints must validate input.')
  })

  it('renames paths to applyTo in frontmatter for copilot rules', () => {
    const copilotDef: AssistantDefinition = {
      id: 'copilot',
      name: 'GitHub Copilot',
      detection: {directories: [], files: []},
      targetMappings: [
        {
          sourceGlob: 'rules/**',
          destination: '.github/instructions/',
          transforms: [
            {transformer: 'rename', params: {from: '.md', to: '.instructions.md'}},
            {transformer: 'frontmatter-rename', params: {from: 'paths', to: 'applyTo'}},
          ],
        },
      ],
    }
    const ruleWithFrontmatter: SourceFile[] = [
      {
        relativePath: 'rules/api.md',
        content: '---\npaths:\n  - "src/**"\n---\nUse strict types.',
      },
    ]
    const result = resolveTargets(ruleWithFrontmatter, [copilotDef])
    const rule = result.find((r) => r.sourcePath === 'rules/api.md')!
    expect(rule.content).toContain('applyTo:')
    expect(rule.content).not.toContain('paths:')
    expect(rule.targetPath).toBe('.github/instructions/api.instructions.md')
  })

  it('leaves content unchanged when no transforms', () => {
    const ruleWithFrontmatter: SourceFile[] = [
      {
        relativePath: 'rules/api.md',
        content: '---\npaths:\n  - "src/**"\n---\nKeep paths key.',
      },
    ]
    const result = resolveTargets(ruleWithFrontmatter, [claudeDef])
    const rule = result.find((r) => r.sourcePath === 'rules/api.md')!
    expect(rule.content).toContain('paths:')
  })

  it('leaves content unchanged when file has no frontmatter', () => {
    const result = resolveTargets(sourceFiles, [cursorDef])
    const rule = result.find((r) => r.sourcePath === 'rules/no-any.md')!
    expect(rule.content).toBe('# No any')
  })

  it('ignores unknown content transformer gracefully', () => {
    const defWithBadContent: AssistantDefinition = {
      ...cursorDef,
      targetMappings: [
        {
          sourceGlob: 'rules/**',
          destination: '.cursor/rules/',
          transforms: [{transformer: 'nonexistent', params: {from: 'foo', to: 'bar'}}],
        },
      ],
    }
    const ruleWithFrontmatter: SourceFile[] = [
      {
        relativePath: 'rules/api.md',
        content: '---\npaths:\n  - "src/**"\n---\nBody.',
      },
    ]
    const result = resolveTargets(ruleWithFrontmatter, [defWithBadContent])
    expect(result[0].content).toContain('paths:')
  })
})

// ── Pre-structured resolver (auto-detected via resolveTargets) ──────────

const claudeOnlyDefs: readonly AssistantDefinition[] = [claudeDef]
const multiDefs: readonly AssistantDefinition[] = [claudeDef, cursorDef, windsurfDef]

function preFiles(...paths: string[]): SourceFile[] {
  return paths.map((p) => ({relativePath: p, content: `content of ${p}`}))
}

describe('resolveTargets — pre-structured layout', () => {
  it('maps files to their original paths', () => {
    const result = resolveTargets(preFiles('.claude/rules/api.md', '.claude/skills/deploy.md'), claudeOnlyDefs, 'src')

    expect(result).toHaveLength(2)
    expect(result[0].targetPath).toBe('.claude/rules/api.md')
    expect(result[0].sourcePath).toBe('.claude/rules/api.md')
    expect(result[0].assistantId).toBe('claude-code')
    expect(result[0].sourceName).toBe('src')
  })

  it('filters out files for disabled assistants', () => {
    const result = resolveTargets(preFiles('.claude/rules/api.md', '.cursor/rules/api.mdc'), claudeOnlyDefs)

    expect(result).toHaveLength(1)
    expect(result[0].assistantId).toBe('claude-code')
  })

  it('includes files for multiple enabled assistants', () => {
    const result = resolveTargets(
      preFiles('.claude/rules/api.md', '.cursor/rules/api.mdc', '.windsurf/rules/api.md'),
      multiDefs,
    )

    expect(result).toHaveLength(3)
  })

  it('returns empty for files with no matching assistant', () => {
    const result = resolveTargets(preFiles('random/file.md'), claudeOnlyDefs)

    expect(result).toHaveLength(0)
  })

  it('preserves content', () => {
    const result = resolveTargets(preFiles('.claude/rules/api.md'), claudeOnlyDefs)

    expect(result[0].content).toBe('content of .claude/rules/api.md')
  })
})
