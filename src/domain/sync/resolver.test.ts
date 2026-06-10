import '../assistants/claude-code'
import '../assistants/cursor'
import '../assistants/windsurf'
import '../assistants/copilot'
import '../assistants/cline'
import '../transforms/frontmatter-rename'
import '../transforms/rename'

import {afterEach, describe, expect, it} from 'bun:test'

import type {AssistantDefinition} from '../assistants/types'
import {setGlobalMode} from '../scope'
import {resolveTargets} from './resolver'
import type {SourceFile} from './types'

afterEach(() => setGlobalMode(false))

const cursorDef: AssistantDefinition = {
  id: 'cursor',
  name: 'Cursor',
  detection: {directories: ['.cursor'], files: []},
  targetMappings: [
    {sourceGlob: 'skills/**', destination: {project: '.cursor/skills/'}},
    {
      sourceGlob: 'rules/**',
      destination: {project: '.cursor/rules/'},
      transforms: [
        {transformer: 'rename', params: {from: '.md', to: '.mdc'}},
        {transformer: 'frontmatter-rename', params: {from: 'paths', to: 'globs'}},
      ],
    },
    {sourceGlob: 'workflows/**', destination: {project: '.cursor/commands/'}},
  ],
}

const claudeDef: AssistantDefinition = {
  id: 'claude-code',
  name: 'Claude Code',
  detection: {directories: ['.claude'], files: []},
  targetMappings: [
    {sourceGlob: 'skills/**', destination: {project: '.claude/skills/'}},
    {sourceGlob: 'rules/**', destination: {project: '.claude/rules/'}},
  ],
}

const windsurfDef: AssistantDefinition = {
  id: 'windsurf',
  name: 'Windsurf',
  detection: {directories: ['.windsurf'], files: []},
  targetMappings: [
    {sourceGlob: 'skills/**', destination: {project: '.windsurf/skills/'}},
    {sourceGlob: 'rules/**', destination: {project: '.windsurf/rules/'}},
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
          destination: {project: '.cursor/skills/'},
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
          destination: {project: '.github/instructions/'},
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
          destination: {project: '.cursor/rules/'},
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

// ── Hybrid resolver (auto-detected via resolveTargets) ──────────────────

describe('resolveTargets — hybrid layout', () => {
  it('resolves both pre-structured and canonical files', () => {
    const hybridFiles: SourceFile[] = [
      {relativePath: '.claude/rules/special.md', content: '# Claude special'},
      {relativePath: 'rules/shared.md', content: '# Shared rule'},
    ]
    const result = resolveTargets(hybridFiles, claudeOnlyDefs, 'hybrid-src')

    const preStructured = result.find((r) => r.targetPath === '.claude/rules/special.md')
    expect(preStructured).toBeDefined()
    expect(preStructured!.content).toBe('# Claude special')
    expect(preStructured!.assistantId).toBe('claude-code')

    const canonical = result.find((r) => r.sourcePath === 'rules/shared.md')
    expect(canonical).toBeDefined()
    expect(canonical!.targetPath).toBe('.claude/rules/shared.md')
    expect(canonical!.assistantId).toBe('claude-code')
  })

  it('applies transforms to canonical portion only', () => {
    const hybridFiles: SourceFile[] = [
      {relativePath: '.cursor/rules/cursor-only.mdc', content: '# Cursor only'},
      {relativePath: 'rules/shared.md', content: '---\npaths:\n  - "src/**"\n---\n# Shared'},
    ]
    const result = resolveTargets(hybridFiles, [cursorDef])

    const preStructured = result.find((r) => r.targetPath === '.cursor/rules/cursor-only.mdc')
    expect(preStructured).toBeDefined()
    expect(preStructured!.content).toBe('# Cursor only')

    const canonical = result.find((r) => r.sourcePath === 'rules/shared.md')
    expect(canonical).toBeDefined()
    expect(canonical!.targetPath).toBe('.cursor/rules/shared.mdc')
    expect(canonical!.content).toContain('globs:')
    expect(canonical!.content).not.toContain('paths:')
  })

  it('distributes canonical files to all enabled assistants', () => {
    const hybridFiles: SourceFile[] = [
      {relativePath: '.claude/rules/claude-only.md', content: '# Claude only'},
      {relativePath: 'rules/shared.md', content: '# Shared'},
    ]
    const result = resolveTargets(hybridFiles, multiDefs, 'src')

    const claudePreStructured = result.filter((r) => r.targetPath === '.claude/rules/claude-only.md')
    expect(claudePreStructured).toHaveLength(1)

    const sharedTargets = result.filter((r) => r.sourcePath === 'rules/shared.md')
    expect(sharedTargets.length).toBeGreaterThanOrEqual(3)
    const assistantIds = new Set(sharedTargets.map((r) => r.assistantId))
    expect(assistantIds.has('claude-code')).toBe(true)
    expect(assistantIds.has('cursor')).toBe(true)
    expect(assistantIds.has('windsurf')).toBe(true)
  })

  it('pre-structured wins over canonical for same targetPath', () => {
    const hybridFiles: SourceFile[] = [
      {relativePath: '.claude/rules/api.md', content: '# Pre-structured version'},
      {relativePath: 'rules/api.md', content: '# Canonical version'},
    ]
    const result = resolveTargets(hybridFiles, claudeOnlyDefs)

    const targets = result.filter((r) => r.targetPath === '.claude/rules/api.md')
    expect(targets).toHaveLength(1)
    expect(targets[0].content).toBe('# Pre-structured version')
    expect(targets[0].sourcePath).toBe('.claude/rules/api.md')
  })
})

// ── Global mode ─────────────────────────────────────────────────────────

const windsurfGlobalDef: AssistantDefinition = {
  id: 'windsurf',
  name: 'Windsurf',
  detection: {directories: ['.windsurf'], files: []},
  targetMappings: [
    {sourceGlob: 'skills/**', destination: {project: '.windsurf/skills/', global: '.codeium/windsurf/skills/'}},
    {sourceGlob: 'rules/**', destination: {project: '.windsurf/rules/'}},
  ],
}

describe('resolveTargets — global mode (canonical)', () => {
  it('uses global destination when defined', () => {
    setGlobalMode(true)
    const result = resolveTargets(sourceFiles, [windsurfGlobalDef])
    const skill = result.find((r) => r.sourcePath === 'skills/typescript.md')
    expect(skill!.targetPath).toBe('.codeium/windsurf/skills/typescript.md')
  })

  it('falls back to project destination when global is undefined', () => {
    setGlobalMode(true)
    const result = resolveTargets(sourceFiles, [windsurfGlobalDef])
    const rule = result.find((r) => r.sourcePath === 'rules/no-any.md')
    expect(rule!.targetPath).toBe('.windsurf/rules/no-any.md')
  })

  it('uses project destination when not in global mode', () => {
    const result = resolveTargets(sourceFiles, [windsurfGlobalDef])
    const skill = result.find((r) => r.sourcePath === 'skills/typescript.md')
    expect(skill!.targetPath).toBe('.windsurf/skills/typescript.md')
  })
})

describe('resolveTargets — global mode (pre-structured)', () => {
  it('remaps project prefix to global destination', () => {
    setGlobalMode(true)
    const result = resolveTargets(preFiles('.windsurf/skills/deploy.md'), [windsurfGlobalDef])
    expect(result).toHaveLength(1)
    expect(result[0].targetPath).toBe('.codeium/windsurf/skills/deploy.md')
    expect(result[0].sourcePath).toBe('.windsurf/skills/deploy.md')
  })

  it('falls back to project prefix when no global defined', () => {
    setGlobalMode(true)
    const result = resolveTargets(preFiles('.windsurf/rules/api.md'), [windsurfGlobalDef])
    expect(result[0].targetPath).toBe('.windsurf/rules/api.md')
  })

  it('keeps original paths in project mode', () => {
    const result = resolveTargets(preFiles('.windsurf/skills/deploy.md'), [windsurfGlobalDef])
    expect(result[0].targetPath).toBe('.windsurf/skills/deploy.md')
  })
})

describe('resolveTargets — global mode (hybrid)', () => {
  it('remaps pre-structured and canonical portions', () => {
    setGlobalMode(true)
    const hybridFiles: SourceFile[] = [
      {relativePath: '.windsurf/skills/existing.md', content: '# Existing'},
      {relativePath: 'skills/new.md', content: '# New'},
    ]
    const result = resolveTargets(hybridFiles, [windsurfGlobalDef])

    const pre = result.find((r) => r.sourcePath === '.windsurf/skills/existing.md')
    expect(pre!.targetPath).toBe('.codeium/windsurf/skills/existing.md')

    const canonical = result.find((r) => r.sourcePath === 'skills/new.md')
    expect(canonical!.targetPath).toBe('.codeium/windsurf/skills/new.md')
  })
})
