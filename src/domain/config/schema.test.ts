import {describe, expect, it} from 'bun:test'

import {globalConfigSchema, projectConfigSchema} from './schema'

describe('projectConfigSchema', () => {
    it('parses a minimal valid config', () => {
        const result = projectConfigSchema.parse({version: '1', assistants: []})
        expect(result.version).toBe('1')
        expect(result.assistants).toEqual([])
    })

    it('parses a full config with git source', () => {
        const raw = {
            version: '1',
            project: {name: 'my-project'},
            assistants: [{id: 'cursor', enabled: true}],
            source: {name: 'team', type: 'git', url: 'git@github.com:org/repo.git', branch: 'main'},
            lastSync: '2024-01-01T00:00:00.000Z',
        }
        const result = projectConfigSchema.parse(raw)
        expect(result.source?.type).toBe('git')
        expect(result.assistants[0].id).toBe('cursor')
    })

    it('parses a local source', () => {
        const raw = {
            version: '1',
            assistants: [],
            source: {name: 'local', type: 'local', path: '/tmp/skills'},
        }
        const result = projectConfigSchema.parse(raw)
        expect(result.source?.type).toBe('local')
    })

    it('defaults branch to main when missing from git source', () => {
        const raw = {
            version: '1',
            assistants: [],
            source: {name: 'team', type: 'git', url: 'git@github.com:org/repo.git'},
        }
        const result = projectConfigSchema.parse(raw)
        expect((result.source as {branch: string}).branch).toBe('main')
    })

    it('rejects invalid assistant id', () => {
        expect(() =>
            projectConfigSchema.parse({
                version: '1',
                assistants: [{id: 'not-a-real-tool', enabled: true}],
            }),
        ).toThrow()
    })

    it('rejects unknown source type', () => {
        expect(() =>
            projectConfigSchema.parse({
                version: '1',
                assistants: [],
                source: {name: 'x', type: 'ftp', path: '/foo'},
            }),
        ).toThrow()
    })
})

describe('globalConfigSchema', () => {
    it('parses a minimal valid global config', () => {
        const result = globalConfigSchema.parse({version: '1'})
        expect(result.version).toBe('1')
    })

    it('parses defaults with source and assistants', () => {
        const raw = {
            version: '1',
            user: {name: 'Alice'},
            defaults: {
                assistants: [{id: 'windsurf', enabled: true}],
                source: {name: 'global', type: 'git', url: 'git@github.com:org/g.git', branch: 'main'},
            },
        }
        const result = globalConfigSchema.parse(raw)
        expect(result.user?.name).toBe('Alice')
        expect(result.defaults?.assistants?.[0].id).toBe('windsurf')
    })

    it('rejects invalid assistant id in defaults', () => {
        expect(() =>
            globalConfigSchema.parse({
                version: '1',
                defaults: {assistants: [{id: 'bad', enabled: true}]},
            }),
        ).toThrow()
    })
})
