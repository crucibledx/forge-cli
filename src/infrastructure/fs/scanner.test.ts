import {mkdir, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {describe, expect, it} from 'bun:test'

import type {AssistantDefinition} from '@domain/assistants/types'

import {scanForAssistants} from './scanner'

const getDir = useTmpDir('scanner')

const cursorDef: AssistantDefinition = {
    id: 'cursor',
    name: 'Cursor',
    detection: {
        directories: ['.cursor'],
        files: ['.cursorrules', '~/.cursor/mcp.json'],
    },
    targetMappings: [],
}

const windsurfDef: AssistantDefinition = {
    id: 'windsurf',
    name: 'Windsurf',
    detection: {
        directories: ['.windsurf', '~/.codeium/windsurf'],
        files: [],
    },
    targetMappings: [],
}

const claudeDef: AssistantDefinition = {
    id: 'claude-code',
    name: 'Claude Code',
    detection: {
        directories: ['.claude'],
        files: ['CLAUDE.md', '.claude/settings.json'],
    },
    targetMappings: [],
}

describe('scanForAssistants', () => {
    it('returns not-detected when no evidence exists', () => {
        const results = scanForAssistants(getDir(), [cursorDef])
        expect(results).toHaveLength(1)
        expect(results[0].detected).toBe(false)
        expect(results[0].evidence).toBeUndefined()
        expect(results[0].scope).toBeUndefined()
    })

    it('detects assistant by project directory presence', async () => {
        const dir = getDir()
        await mkdir(join(dir, '.cursor'), {recursive: true})
        await writeFile(join(dir, '.cursor', 'no-any.mdc'), 'rule', 'utf-8')
        const results = scanForAssistants(dir, [cursorDef])
        expect(results[0].detected).toBe(true)
        expect(results[0].scope).toBe('project')
        expect(results[0].evidence).toContain('.cursor/')
    })

    it('detects assistant by project file presence', async () => {
        const dir = getDir()
        await writeFile(join(dir, 'CLAUDE.md'), '# Context', 'utf-8')
        const results = scanForAssistants(dir, [claudeDef])
        expect(results[0].detected).toBe(true)
        expect(results[0].scope).toBe('project')
        expect(results[0].evidence).toContain('CLAUDE.md found')
    })

    it('detects assistant via global ~/directory path', async () => {
        const dir = getDir()
        const fakeHome = join(dir, 'home')
        await mkdir(join(fakeHome, '.codeium', 'windsurf'), {recursive: true})
        const results = scanForAssistants(dir, [windsurfDef], fakeHome)
        expect(results[0].detected).toBe(true)
        expect(results[0].scope).toBe('global')
        expect(results[0].evidence).toContain('~/.codeium/windsurf/')
    })

    it('detects assistant via global ~/file path', async () => {
        const dir = getDir()
        const fakeHome = join(dir, 'home')
        await mkdir(join(fakeHome, '.cursor'), {recursive: true})
        await writeFile(join(fakeHome, '.cursor', 'mcp.json'), '{}', 'utf-8')
        const results = scanForAssistants(dir, [cursorDef], fakeHome)
        expect(results[0].detected).toBe(true)
        expect(results[0].scope).toBe('global')
        expect(results[0].evidence).toContain('~/.cursor/mcp.json')
    })

    it('scope is "project" when detected in both project and global', async () => {
        const dir = getDir()
        const fakeHome = join(dir, 'home')
        await mkdir(join(dir, '.windsurf'), {recursive: true})
        await mkdir(join(fakeHome, '.codeium', 'windsurf'), {recursive: true})
        const results = scanForAssistants(dir, [windsurfDef], fakeHome)
        expect(results[0].scope).toBe('project')
    })

    it('includes item count in evidence for non-empty directory', async () => {
        const dir = getDir()
        await mkdir(join(dir, '.cursor'), {recursive: true})
        await writeFile(join(dir, '.cursor', 'a.md'), 'a', 'utf-8')
        await writeFile(join(dir, '.cursor', 'b.md'), 'b', 'utf-8')
        const results = scanForAssistants(dir, [cursorDef])
        expect(results[0].evidence).toContain('2 items')
    })

    it('marks empty detected directory as "empty"', async () => {
        const dir = getDir()
        await mkdir(join(dir, '.cursor'), {recursive: true})
        const results = scanForAssistants(dir, [cursorDef])
        expect(results[0].detected).toBe(true)
        expect(results[0].evidence).toContain('empty')
    })

    it('scans multiple assistants and returns a result for each', async () => {
        const dir = getDir()
        await mkdir(join(dir, '.cursor'), {recursive: true})
        const results = scanForAssistants(dir, [cursorDef, claudeDef])
        expect(results).toHaveLength(2)
        expect(results.find((r) => r.id === 'cursor')?.detected).toBe(true)
        expect(results.find((r) => r.id === 'claude-code')?.detected).toBe(false)
    })

    it('returns results in same order as input assistants array', () => {
        const results = scanForAssistants(getDir(), [claudeDef, cursorDef])
        expect(results[0].id).toBe('claude-code')
        expect(results[1].id).toBe('cursor')
    })
})
