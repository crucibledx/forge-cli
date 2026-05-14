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
        {sourceGlob: 'rules/**', destination: '.cursor/rules/', transform: 'rename:.md→.mdc', contentTransform: 'frontmatter:paths→globs'},
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
        const claudeSkills = result.filter((r) => r.assistantId === 'claude-code' && r.sourcePath === 'skills/typescript.md')
        expect(cursorSkills).toHaveLength(1)
        expect(claudeSkills).toHaveLength(1)
    })

    it('carries source file content to resolved target', () => {
        const result = resolveTargets(sourceFiles, [claudeDef])
        const rule = result.find((r) => r.sourcePath === 'rules/no-any.md')
        expect(rule!.content).toBe('# No any')
    })

    it('ignores unknown transform prefix gracefully (returns filename unchanged)', () => {
        const defWithBadTransform: AssistantDefinition = {
            ...cursorDef,
            targetMappings: [
                {sourceGlob: 'skills/**', destination: '.cursor/skills/', transform: 'unknown:foo→bar'},
            ],
        }
        const result = resolveTargets(sourceFiles, [defWithBadTransform])
        const skill = result.find((r) => r.sourcePath === 'skills/typescript.md')
        expect(skill!.targetPath).toBe('.cursor/skills/typescript.md')
    })

    it('ignores transform with no colon gracefully', () => {
        const defWithMalformed: AssistantDefinition = {
            ...cursorDef,
            targetMappings: [
                {sourceGlob: 'skills/**', destination: '.cursor/skills/', transform: 'notransform'},
            ],
        }
        const result = resolveTargets(sourceFiles, [defWithMalformed])
        const skill = result.find((r) => r.sourcePath === 'skills/typescript.md')
        expect(skill!.targetPath).toBe('.cursor/skills/typescript.md')
    })

    // ── Content transforms (frontmatter) ─────────────────────────────────

    it('renames paths→globs in frontmatter for cursor rules', () => {
        const ruleWithFrontmatter: SourceFile[] = [{
            relativePath: 'rules/api.md',
            content: '---\npaths:\n  - "src/api/**/*.ts"\n---\nAll endpoints must validate input.',
        }]
        const result = resolveTargets(ruleWithFrontmatter, [cursorDef])
        const rule = result.find((r) => r.sourcePath === 'rules/api.md')!
        expect(rule.content).toContain('globs:')
        expect(rule.content).not.toContain('paths:')
        expect(rule.content).toContain('All endpoints must validate input.')
    })

    it('renames paths→applyTo in frontmatter for copilot rules', () => {
        const copilotDef: AssistantDefinition = {
            id: 'copilot',
            name: 'GitHub Copilot',
            detection: {directories: [], files: []},
            targetMappings: [
                {sourceGlob: 'rules/**', destination: '.github/instructions/', transform: 'rename:.md→.instructions.md', contentTransform: 'frontmatter:paths→applyTo'},
            ],
        }
        const ruleWithFrontmatter: SourceFile[] = [{
            relativePath: 'rules/api.md',
            content: '---\npaths:\n  - "src/**"\n---\nUse strict types.',
        }]
        const result = resolveTargets(ruleWithFrontmatter, [copilotDef])
        const rule = result.find((r) => r.sourcePath === 'rules/api.md')!
        expect(rule.content).toContain('applyTo:')
        expect(rule.content).not.toContain('paths:')
        expect(rule.targetPath).toBe('.github/instructions/api.instructions.md')
    })

    it('leaves content unchanged when no contentTransform', () => {
        const ruleWithFrontmatter: SourceFile[] = [{
            relativePath: 'rules/api.md',
            content: '---\npaths:\n  - "src/**"\n---\nKeep paths key.',
        }]
        const result = resolveTargets(ruleWithFrontmatter, [claudeDef])
        const rule = result.find((r) => r.sourcePath === 'rules/api.md')!
        expect(rule.content).toContain('paths:')
    })

    it('leaves content unchanged when file has no frontmatter', () => {
        const result = resolveTargets(sourceFiles, [cursorDef])
        const rule = result.find((r) => r.sourcePath === 'rules/no-any.md')!
        expect(rule.content).toBe('# No any')
    })

    it('ignores unknown contentTransform type gracefully', () => {
        const defWithBadContent: AssistantDefinition = {
            ...cursorDef,
            targetMappings: [
                {sourceGlob: 'rules/**', destination: '.cursor/rules/', contentTransform: 'unknown:foo→bar'},
            ],
        }
        const ruleWithFrontmatter: SourceFile[] = [{
            relativePath: 'rules/api.md',
            content: '---\npaths:\n  - "src/**"\n---\nBody.',
        }]
        const result = resolveTargets(ruleWithFrontmatter, [defWithBadContent])
        expect(result[0].content).toContain('paths:')
    })
})
