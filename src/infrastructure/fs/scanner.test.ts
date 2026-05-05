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
        directories: ['.cursor', '.cursor/rules'],
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
    it('returns not-detected when no evidence exists', async () => {
        const results = await scanForAssistants(getDir(), [cursorDef])
        expect(results).toHaveLength(1)
        expect(results[0].detected).toBe(false)
        expect(results[0].evidence).toBeUndefined()
    })

    it('detects assistant by directory presence', async () => {
        const dir = getDir()
        await mkdir(join(dir, '.cursor', 'rules'), {recursive: true})
        await writeFile(join(dir, '.cursor', 'rules', 'no-any.mdc'), 'rule', 'utf-8')
        const results = await scanForAssistants(dir, [cursorDef])
        expect(results[0].detected).toBe(true)
        expect(results[0].evidence).toContain('.cursor/')
    })

    it('detects assistant by file presence', async () => {
        const dir = getDir()
        await writeFile(join(dir, 'CLAUDE.md'), '# Context', 'utf-8')
        const results = await scanForAssistants(dir, [claudeDef])
        expect(results[0].detected).toBe(true)
        expect(results[0].evidence).toContain('CLAUDE.md found')
    })

    it('includes item count in evidence for non-empty directory', async () => {
        const dir = getDir()
        await mkdir(join(dir, '.cursor'), {recursive: true})
        await writeFile(join(dir, '.cursor', 'a.md'), 'a', 'utf-8')
        await writeFile(join(dir, '.cursor', 'b.md'), 'b', 'utf-8')
        const results = await scanForAssistants(dir, [cursorDef])
        expect(results[0].evidence).toContain('2 items')
    })

    it('marks empty detected directory as "empty"', async () => {
        const dir = getDir()
        await mkdir(join(dir, '.cursor'), {recursive: true})
        const results = await scanForAssistants(dir, [cursorDef])
        expect(results[0].detected).toBe(true)
        expect(results[0].evidence).toContain('empty')
    })

    it('scans multiple assistants and returns a result for each', async () => {
        const dir = getDir()
        await mkdir(join(dir, '.cursor'), {recursive: true})
        const results = await scanForAssistants(dir, [cursorDef, claudeDef])
        expect(results).toHaveLength(2)
        expect(results.find((r) => r.id === 'cursor')?.detected).toBe(true)
        expect(results.find((r) => r.id === 'claude-code')?.detected).toBe(false)
    })

    it('returns results in same order as input assistants array', async () => {
        const results = await scanForAssistants(getDir(), [claudeDef, cursorDef])
        expect(results[0].id).toBe('claude-code')
        expect(results[1].id).toBe('cursor')
    })
})
