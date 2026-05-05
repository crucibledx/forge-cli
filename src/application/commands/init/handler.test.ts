/**
 * Unit tests for runInit handler.
 *
 * All I/O is mocked at the infrastructure boundary. Bun requires mock.module()
 * calls before any dynamic import of the module under test.
 */

import {beforeEach, describe, expect, it, mock} from 'bun:test'

import {cursor} from '@domain/assistants/cursor'
import {windsurf} from '@domain/assistants/windsurf'

import {INIT_MESSAGES as M} from './messages'

// ─── Shared mock state ────────────────────────────────────────────────────────

let mockProjectRoot = '/fake/project'
let mockConfigExists = false
let mockDetectionResults: Array<{id: string, name: string, detected: boolean}> = []
let writtenConfig: unknown = null
let promptResponses: Record<string, unknown> = {}

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
    scanForAssistants: async () => mockDetectionResults,
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
    renderWarning: () => {
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
        mockDetectionResults = [
            {id: cursor.id, name: cursor.name, detected: false},
            {id: windsurf.id, name: windsurf.name, detected: false},
        ]
    })

    it('writes config with no assistants when user declines all', async () => {
        promptResponses = {[M.assistants.addUndetected(cursor.name)]: false, [M.assistants.addUndetected(windsurf.name)]: false, [M.source.addSource]: false}
        const {runInit} = await import('./handler')
        await runInit({verbose: false})
        expect(writtenConfig).not.toBeNull()
        expect((writtenConfig as {assistants: unknown[]}).assistants).toEqual([])
    })

    it('writes config with enabled assistant when user accepts', async () => {
        promptResponses = {[M.assistants.addUndetected(cursor.name)]: true, [M.assistants.addUndetected(windsurf.name)]: false, [M.source.addSource]: false}
        const {runInit} = await import('./handler')
        await runInit({verbose: false})
        const assistants = (writtenConfig as {assistants: Array<{id: string, enabled: boolean}>}).assistants
        expect(assistants).toHaveLength(1)
        expect(assistants[0].id).toBe(cursor.id)
        expect(assistants[0].enabled).toBe(true)
    })

    it('includes git source in config when user adds one', async () => {
        promptResponses = {
            [M.assistants.addUndetected(cursor.name)]: false,
            [M.assistants.addUndetected(windsurf.name)]: false,
            [M.source.addSource]: true,
            [M.source.selectType]: 'git',
            [M.source.git.url.message]: 'git@github.com:org/repo.git',
            [M.source.git.branch]: 'main',
            [M.source.git.subdirectory.message]: '',
            [M.sync.runNow]: false,
        }
        const {runInit} = await import('./handler')
        await runInit({verbose: false})
        const cfg = writtenConfig as {source?: {url: string, type: string}}
        expect(cfg.source?.url).toBe('git@github.com:org/repo.git')
        expect(cfg.source?.type).toBe('git')
    })

    it('includes local source in config when user selects local type', async () => {
        promptResponses = {
            [M.assistants.addUndetected(cursor.name)]: false,
            [M.assistants.addUndetected(windsurf.name)]: false,
            [M.source.addSource]: true,
            [M.source.selectType]: 'local',
            [M.source.local.path.message]: '~/my-ai-configs',
            [M.sync.runNow]: false,
        }
        const {runInit} = await import('./handler')
        await runInit({verbose: false})
        const cfg = writtenConfig as {source?: {path: string, type: string}}
        expect(cfg.source?.type).toBe('local')
        expect(cfg.source?.path).toBe('~/my-ai-configs')
    })

    it('keeps detected assistant when user confirms', async () => {
        mockDetectionResults = [
            {id: cursor.id, name: cursor.name, detected: true},
            {id: windsurf.id, name: windsurf.name, detected: false},
        ]
        promptResponses = {[M.assistants.keepDetected(cursor.name)]: true, [M.assistants.addUndetected(windsurf.name)]: false, [M.source.addSource]: false}
        const {runInit} = await import('./handler')
        await runInit({verbose: false})
        const assistants = (writtenConfig as {assistants: Array<{id: string, enabled: boolean}>}).assistants
        expect(assistants.find((a) => a.id === cursor.id)?.enabled).toBe(true)
    })

    it('excludes detected assistant when user declines keep', async () => {
        mockDetectionResults = [
            {id: cursor.id, name: cursor.name, detected: true},
            {id: windsurf.id, name: windsurf.name, detected: false},
        ]
        promptResponses = {[M.assistants.keepDetected(cursor.name)]: false, [M.assistants.addUndetected(windsurf.name)]: false, [M.source.addSource]: false}
        const {runInit} = await import('./handler')
        await runInit({verbose: false})
        // declined detected assistants are filtered from enabledAssistants — not present in output
        const assistants = (writtenConfig as {assistants: Array<{id: string}>}).assistants
        expect(assistants.find((a) => a.id === cursor.id)).toBeUndefined()
    })

    it('aborts without writing when config already exists', async () => {
        mockConfigExists = true
        const {runInit} = await import('./handler')
        await runInit({verbose: false})
        expect(writtenConfig).toBeNull()
    })

    it('proceeds to write when no existing config', async () => {
        mockConfigExists = false
        promptResponses = {
            [M.assistants.addUndetected(cursor.name)]: false,
            [M.assistants.addUndetected(windsurf.name)]: false,
            [M.source.addSource]: false,
        }
        const {runInit} = await import('./handler')
        await runInit({verbose: false})
        expect(writtenConfig).not.toBeNull()
    })

    it('uses project directory name as config project name', async () => {
        mockProjectRoot = '/workspace/my-app'
        promptResponses = {[M.assistants.addUndetected(cursor.name)]: false, [M.assistants.addUndetected(windsurf.name)]: false, [M.source.addSource]: false}
        const {runInit} = await import('./handler')
        await runInit({verbose: false})
        expect((writtenConfig as {project?: {name: string}}).project?.name).toBe('my-app')
    })
})
