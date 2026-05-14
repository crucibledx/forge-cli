/**
 * Unit tests for the assistants config section editor.
 */

import {beforeEach, describe, expect, it, mock} from 'bun:test'

import {cursor} from '@domain/assistants/cursor'
import {windsurf} from '@domain/assistants/windsurf'
import type {ProjectConfig} from '@domain/config/types'

import {ASSISTANTS_MESSAGES as M} from './assistants'

// ─── Mock state ──────────────────────────────────────────────────────────────

let mockDetectionResults: Array<{id: string, name: string, detected: boolean, scope?: 'project' | 'global'}> = []
let promptResponses: Record<string, unknown> = {}

// ─── Mocks ───────────────────────────────────────────────────────────────────

mock.module('@domain/assistants/registry', () => ({
    getAllAssistants: () => [
        {...cursor, detection: {directories: [], files: []}, targetMappings: []},
        {...windsurf, detection: {directories: [], files: []}, targetMappings: []},
    ],
}))

mock.module('@infrastructure/fs', () => ({
    scanForAssistants: () => mockDetectionResults,
}))

mock.module('@infrastructure/cli/renderer', () => ({
    renderNewline: () => {},
    renderWarning: () => {},
    renderSuccess: () => {},
}))

mock.module('@infrastructure/cli/prompts', () => ({
    spinner: () => ({start: () => {}, stop: () => {}}),
    multiselect: async (opts: {message: string}) => promptResponses[opts.message] ?? [],
}))

// ─── Reset ───────────────────────────────────────────────────────────────────

beforeEach(() => {
    mockDetectionResults = []
    promptResponses = {}
})

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('assistantsSection', () => {
    const baseConfig: ProjectConfig = {version: '1', assistants: [], sources: []}

    it('hint returns count of enabled assistants', async () => {
        const {assistantsSection} = await import('./assistants')
        expect(assistantsSection.hint(baseConfig)).toBe('none enabled')
        expect(assistantsSection.hint({
            ...baseConfig,
            assistants: [{id: 'cursor', enabled: true}, {id: 'windsurf', enabled: true}],
        })).toBe('2 enabled')
    })

    it('returns config with selected assistants', async () => {
        promptResponses = {[M.select]: [cursor.id, windsurf.id]}
        const {assistantsSection} = await import('./assistants')
        const result = await assistantsSection.edit(baseConfig, '/fake')
        expect(result.assistants).toHaveLength(2)
        expect(result.assistants[0].id).toBe(cursor.id)
        expect(result.assistants[1].id).toBe(windsurf.id)
        expect(result.assistants.every((a) => a.enabled)).toBe(true)
    })

    it('returns empty assistants when none selected', async () => {
        promptResponses = {[M.select]: []}
        const {assistantsSection} = await import('./assistants')
        const result = await assistantsSection.edit(baseConfig, '/fake')
        expect(result.assistants).toHaveLength(0)
    })

    it('preserves other config fields', async () => {
        const config: ProjectConfig = {
            ...baseConfig,
            sources: [{name: 'default', type: 'local', path: '/tmp'}],
        }
        promptResponses = {[M.select]: [cursor.id]}
        const {assistantsSection} = await import('./assistants')
        const result = await assistantsSection.edit(config, '/fake')
        expect(result.sources).toEqual(config.sources)
    })
})
