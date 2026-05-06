/**
 * Unit tests for runInit handler.
 *
 * All I/O is mocked at the infrastructure boundary. Bun requires mock.module()
 * calls before any dynamic import of the module under test.
 */

import {beforeEach, describe, expect, it, mock} from 'bun:test'

import {cursor} from '@domain/assistants/cursor'
import {windsurf} from '@domain/assistants/windsurf'
import type {Source} from '@domain/config/types'

import {INIT_MESSAGES as M} from './messages'

// ─── Shared mock state ────────────────────────────────────────────────────────

let mockProjectRoot = '/fake/project'
let mockConfigExists = false
let mockDetectionResults: Array<{id: string, name: string, detected: boolean, scope?: 'project' | 'global'}> = []
let writtenConfig: unknown = null
let promptResponses: Record<string, unknown> = {}
let mockSourceByType: Record<string, Source> = {}
let scanCalled = false
let rendererWarnings: string[] = []

// ─── Mocks ────────────────────────────────────────────────────────────────────

mock.module('@infrastructure/io', () => ({
    default: {
        resolveProjectRoot: () => mockProjectRoot,
        buildContext: async () => ({
            projectRoot: mockProjectRoot,
            globalConfig: null,
            projectConfig: null,
            hasProjectConfig: false
        }),
    },
}))

mock.module('@domain/assistants/registry', () => ({
    getAllAssistants: () => [
        {...cursor, detection: {directories: [], files: []}, targetMappings: []},
        {...windsurf, detection: {directories: [], files: []}, targetMappings: []},
    ],
}))

mock.module('@infrastructure/fs', () => ({
    scanForAssistants: () => {
        scanCalled = true
        return mockDetectionResults
    },
    applyMutations: async () => [],
    collectFiles: async () => [],
    rollbackMutations: async () => {
    },
}))

mock.module('@infrastructure/config', () => ({
    projectConfigExists: () => mockConfigExists,
    writeProjectConfig: async (_root: string, config: unknown) => {
        writtenConfig = config
        return `${mockProjectRoot}/.crucible/forge.config.yaml`
    },
    loadProjectConfig: async () => null,
    loadGlobalConfig: async () => null,
}))

mock.module('@infrastructure/cli/renderer', () => ({
    renderNewline: () => {
    },
    renderInfo: () => {
    },
    renderDetectionResults: () => {
    },
    renderWarning: (msg: string) => {
        rendererWarnings.push(msg)
    },
    renderSuccess: () => {
    },
    renderDim: () => {
    },
    renderError: () => {
    },
}))

mock.module('@infrastructure/cli/prompts', () => ({
    intro: () => {
    },
    outro: () => {
    },
    spinner: () => ({
        start: () => {
        }, stop: () => {
        }
    }),
    confirm: async (opts: {message: string}) => promptResponses[opts.message] ?? false,
    select: async (opts: {message: string}) => promptResponses[opts.message] ?? 'git',
    multiselect: async (opts: {message: string}) => promptResponses[opts.message] ?? [],
    text: async (opts: {
        message: string
        defaultValue?: string
    }) => promptResponses[opts.message] ?? opts.defaultValue ?? '',
}))

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

mock.module('../sync', () => ({
    syncCommand: {
        action: async () => {
        }
    },
}))

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('runInit handler', () => {
    beforeEach(() => {
        mockProjectRoot = '/fake/project'
        mockConfigExists = false
        writtenConfig = null
        promptResponses = {}
        mockSourceByType = {}
        scanCalled = false
        rendererWarnings = []
        mockDetectionResults = [
            {id: cursor.id, name: cursor.name, detected: false, scope: undefined},
            {id: windsurf.id, name: windsurf.name, detected: false, scope: undefined},
        ]
    })

    it('writes config with no assistants when user selects none', async () => {
        promptResponses = {[M.assistants.select]: [], [M.source.addSource]: false}
        const {runInit} = await import('./handler')
        await runInit({verbose: false})
        expect(writtenConfig).not.toBeNull()
        expect((writtenConfig as {assistants: unknown[]}).assistants).toEqual([])
    })

    it('writes config with enabled assistant when user selects one', async () => {
        promptResponses = {[M.assistants.select]: [cursor.id], [M.source.addSource]: false}
        const {runInit} = await import('./handler')
        await runInit({verbose: false})
        const assistants = (writtenConfig as {assistants: Array<{id: string, enabled: boolean}>}).assistants
        expect(assistants).toHaveLength(1)
        expect(assistants[0].id).toBe(cursor.id)
        expect(assistants[0].enabled).toBe(true)
    })

    it('writes config with multiple assistants when user selects several', async () => {
        promptResponses = {[M.assistants.select]: [cursor.id, windsurf.id], [M.source.addSource]: false}
        const {runInit} = await import('./handler')
        await runInit({verbose: false})
        const assistants = (writtenConfig as {assistants: Array<{id: string}>}).assistants
        expect(assistants).toHaveLength(2)
        expect(assistants.map((a) => a.id)).toContain(cursor.id)
        expect(assistants.map((a) => a.id)).toContain(windsurf.id)
    })

    it('includes git source in config when user adds one', async () => {
        mockSourceByType = {git: {name: 'default', type: 'git', url: 'git@github.com:org/repo.git', branch: 'main'}}
        promptResponses = {
            [M.assistants.select]: [],
            [M.source.addSource]: true,
            [M.source.selectType]: 'git',
            [M.sync.runNow]: false,
        }
        const {runInit} = await import('./handler')
        await runInit({verbose: false})
        const cfg = writtenConfig as {source?: {url: string, type: string}}
        expect(cfg.source?.url).toBe('git@github.com:org/repo.git')
        expect(cfg.source?.type).toBe('git')
    })

    it('includes local source in config when user selects local type', async () => {
        mockSourceByType = {local: {name: 'default', type: 'local', path: '~/my-ai-configs'}}
        promptResponses = {
            [M.assistants.select]: [],
            [M.source.addSource]: true,
            [M.source.selectType]: 'local',
            [M.sync.runNow]: false,
        }
        const {runInit} = await import('./handler')
        await runInit({verbose: false})
        const cfg = writtenConfig as {source?: {path: string, type: string}}
        expect(cfg.source?.type).toBe('local')
        expect(cfg.source?.path).toBe('~/my-ai-configs')
    })

    it('pre-selects detected assistants and includes them when returned', async () => {
        mockDetectionResults = [
            {id: cursor.id, name: cursor.name, detected: true, scope: 'project'},
            {id: windsurf.id, name: windsurf.name, detected: false, scope: undefined},
        ]
        promptResponses = {[M.assistants.select]: [cursor.id], [M.source.addSource]: false}
        const {runInit} = await import('./handler')
        await runInit({verbose: false})
        const assistants = (writtenConfig as {assistants: Array<{id: string, enabled: boolean}>}).assistants
        expect(assistants.find((a) => a.id === cursor.id)?.enabled).toBe(true)
    })

    it('excludes detected assistant when user deselects it', async () => {
        mockDetectionResults = [
            {id: cursor.id, name: cursor.name, detected: true, scope: 'project'},
            {id: windsurf.id, name: windsurf.name, detected: false, scope: undefined},
        ]
        promptResponses = {[M.assistants.select]: [], [M.source.addSource]: false}
        const {runInit} = await import('./handler')
        await runInit({verbose: false})
        const assistants = (writtenConfig as {assistants: Array<{id: string}>}).assistants
        expect(assistants.find((a) => a.id === cursor.id)).toBeUndefined()
    })

    it('aborts without writing when config already exists', async () => {
        mockConfigExists = true
        const {runInit} = await import('./handler')
        await runInit({verbose: false})
        expect(writtenConfig).toBeNull()
    })

    it('does not scan when config already exists', async () => {
        mockConfigExists = true
        const {runInit} = await import('./handler')
        await runInit({verbose: false})
        expect(scanCalled).toBe(false)
    })

    it('renders warning when no assistants selected', async () => {
        promptResponses = {[M.assistants.select]: [], [M.source.addSource]: false}
        const {runInit} = await import('./handler')
        await runInit({verbose: false})
        expect(rendererWarnings).toContain(M.assistants.noneSelected)
    })

    it('proceeds to write when no existing config', async () => {
        mockConfigExists = false
        promptResponses = {
            [M.assistants.select]: [],
            [M.source.addSource]: false,
        }
        const {runInit} = await import('./handler')
        await runInit({verbose: false})
        expect(writtenConfig).not.toBeNull()
    })

    it('uses project directory name as config project name', async () => {
        mockProjectRoot = '/workspace/my-app'
        promptResponses = {[M.assistants.select]: [], [M.source.addSource]: false}
        const {runInit} = await import('./handler')
        await runInit({verbose: false})
        expect((writtenConfig as {project?: {name: string}}).project?.name).toBe('my-app')
    })
})
