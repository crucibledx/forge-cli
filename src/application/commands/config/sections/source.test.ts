/**
 * Unit tests for the source config section editor.
 */

import {beforeEach, describe, expect, it, mock} from 'bun:test'

import type {ProjectConfig, Source} from '@domain/config/types'

import {SOURCE_MESSAGES as M} from './source'

// ─── Mock state ──────────────────────────────────────────────────────────────

let promptResponses: Record<string, unknown> = {}
let mockSourceByType: Record<string, Source> = {}

// ─── Mocks ───────────────────────────────────────────────────────────────────

mock.module('@infrastructure/source', () => ({
    getSourceLoaderOptions: () => [
        {value: 'git', label: 'Git (SSH / HTTPS)'},
        {value: 'local', label: 'Local directory'},
    ],
    getSourceLoader: (type: string) => ({
        alias: type,
        label: type,
        configure: async () => mockSourceByType[type] ?? {name: 'default', type, url: '', branch: 'main'},
        load: async () => ({localPath: '/fake/path', fresh: true}),
    }),
}))

mock.module('@infrastructure/cli/renderer', () => ({
    renderNewline: () => {},
    renderWarning: () => {},
    renderSuccess: () => {},
}))

mock.module('@infrastructure/cli/prompts', () => ({
    select: async (opts: {message: string}) => {
        const val = promptResponses[opts.message]
        if (Array.isArray(val)) return val.shift() ?? ''
        return val ?? ''
    },
    confirm: async (opts: {message: string}) => {
        const val = promptResponses[opts.message]
        if (Array.isArray(val)) return val.shift() ?? false
        return val ?? false
    },
}))

// ─── Reset ───────────────────────────────────────────────────────────────────

beforeEach(() => {
    promptResponses = {}
    mockSourceByType = {}
})

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('sourceSection', () => {
    const baseConfig: ProjectConfig = {version: '1', assistants: [], sources: []}

    it('hint returns none when no sources', async () => {
        const {sourceSection} = await import('./source')
        expect(sourceSection.hint(baseConfig)).toBe('none configured')
    })

    it('hint lists source names', async () => {
        const {sourceSection} = await import('./source')
        const config: ProjectConfig = {
            ...baseConfig,
            sources: [
                {name: 'team', type: 'git', url: 'u', branch: 'main'},
                {name: 'local', type: 'local', path: '/tmp'},
            ],
        }
        expect(sourceSection.hint(config)).toBe('2 configured: team, local')
    })

    it('adds a new source', async () => {
        mockSourceByType = {git: {name: 'default', type: 'git', url: 'git@github.com:org/repo.git', branch: 'main'}}
        promptResponses = {
            [M.action]: ['add', 'done'],
            [M.addType]: 'git',
        }
        const {sourceSection} = await import('./source')
        const result = await sourceSection.edit(baseConfig, '/fake')
        expect(result.sources).toHaveLength(1)
        expect(result.sources[0].type).toBe('git')
    })

    it('removes a source after confirmation', async () => {
        const config: ProjectConfig = {
            ...baseConfig,
            sources: [{name: 'default', type: 'git', url: 'u', branch: 'main'}],
        }
        promptResponses = {
            [M.action]: ['remove', 'done'],
            [M.removeWhich]: 'default',
            [M.confirmRemove('default')]: true,
        }
        const {sourceSection} = await import('./source')
        const result = await sourceSection.edit(config, '/fake')
        expect(result.sources).toHaveLength(0)
    })

    it('keeps source when removal is not confirmed', async () => {
        const config: ProjectConfig = {
            ...baseConfig,
            sources: [{name: 'default', type: 'git', url: 'u', branch: 'main'}],
        }
        promptResponses = {
            [M.action]: ['remove', 'done'],
            [M.removeWhich]: 'default',
            [M.confirmRemove('default')]: false,
        }
        const {sourceSection} = await import('./source')
        const result = await sourceSection.edit(config, '/fake')
        expect(result.sources).toHaveLength(1)
    })

    it('preserves other config fields', async () => {
        const config: ProjectConfig = {
            ...baseConfig,
            assistants: [{id: 'cursor', enabled: true}],
        }
        promptResponses = {[M.action]: 'done'}
        const {sourceSection} = await import('./source')
        const result = await sourceSection.edit(config, '/fake')
        expect(result.assistants).toEqual(config.assistants)
    })
})
