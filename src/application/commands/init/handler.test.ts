/**
 * Unit tests for runInit handler.
 *
 * All I/O is mocked at the infrastructure boundary. Bun requires mock.module()
 * calls before any dynamic import of the module under test.
 */

import {beforeEach, describe, expect, it, mock} from 'bun:test'

import type {Source} from '@domain/config/types'
import {cursor} from '@domain/harnesses/cursor'
import {windsurf} from '@domain/harnesses/windsurf'

import {INIT_MESSAGES as M} from './messages'

// ─── Shared mock state ────────────────────────────────────────────────────────

let mockProjectRoot = '/fake/project'
let mockConfigExists = false
let mockDetectionResults: Array<{id: string; name: string; detected: boolean; scope?: 'project' | 'global'}> = []
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
      projectConfig: null,
      hasProjectConfig: false,
    }),
  },
}))

mock.module('@domain/harnesses/registry', () => ({
  getAllHarnesses: () => [
    {...cursor, detection: {directories: [], files: []}, targetMappings: []},
    {...windsurf, detection: {directories: [], files: []}, targetMappings: []},
  ],
}))

mock.module('@infrastructure/fs', () => ({
  scanForHarnesses: () => {
    scanCalled = true
    return mockDetectionResults
  },
  collectFiles: async () => [],
}))

mock.module('@infrastructure/config', () => ({
  projectConfigExists: () => mockConfigExists,
  loadSyncState: async () => ({lastSync: '', files: {}}),
  writeProjectConfig: async (_root: string, config: unknown) => {
    writtenConfig = config
    return `${mockProjectRoot}/.crucible/forge.config.yaml`
  },
  loadProjectConfig: async () => null,
  writeSyncState: async () => {},
}))

mock.module('@infrastructure/cli/renderer', () => ({
  renderNewline: () => {},
  renderInfo: () => {},
  renderDetectionResults: () => {},
  renderWarning: (msg: string) => {
    rendererWarnings.push(msg)
  },
  renderSuccess: () => {},
  renderDim: () => {},
  renderError: () => {},
}))

mock.module('@infrastructure/cli/prompts', () => ({
  intro: () => {},
  outro: () => {},
  spinner: () => ({
    start: () => {},
    stop: () => {},
  }),
  confirm: async (opts: {message: string}) => {
    const val = promptResponses[opts.message]
    if (Array.isArray(val)) return val.shift() ?? false
    return val ?? false
  },
  select: async (opts: {message: string}) => {
    const val = promptResponses[opts.message]
    if (Array.isArray(val)) return val.shift() ?? 'git'
    return val ?? 'git'
  },
  multiselect: async (opts: {message: string}) => promptResponses[opts.message] ?? [],
  text: async (opts: {message: string; defaultValue?: string}) =>
    promptResponses[opts.message] ?? opts.defaultValue ?? '',
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
    action: async () => {},
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

  it('writes config with no harnesses when user selects none', async () => {
    promptResponses = {[M.harnesses.select]: [], [M.source.addSource]: false}
    const {runInit} = await import('./handler')
    await runInit({verbose: false, force: false})
    expect(writtenConfig).not.toBeNull()
    expect((writtenConfig as {harnesses: unknown[]}).harnesses).toEqual([])
  })

  it('writes config with enabled harness when user selects one', async () => {
    promptResponses = {[M.harnesses.select]: [cursor.id], [M.source.addSource]: false}
    const {runInit} = await import('./handler')
    await runInit({verbose: false, force: false})
    const harnesses = (writtenConfig as {harnesses: Array<{id: string; enabled: boolean}>}).harnesses
    expect(harnesses).toHaveLength(1)
    expect(harnesses[0].id).toBe(cursor.id)
    expect(harnesses[0].enabled).toBe(true)
  })

  it('writes config with multiple harnesses when user selects several', async () => {
    promptResponses = {[M.harnesses.select]: [cursor.id, windsurf.id], [M.source.addSource]: false}
    const {runInit} = await import('./handler')
    await runInit({verbose: false, force: false})
    const harnesses = (writtenConfig as {harnesses: Array<{id: string}>}).harnesses
    expect(harnesses).toHaveLength(2)
    expect(harnesses.map((a) => a.id)).toContain(cursor.id)
    expect(harnesses.map((a) => a.id)).toContain(windsurf.id)
  })

  it('includes git source in config when user adds one', async () => {
    mockSourceByType = {git: {name: 'default', type: 'git', url: 'git@github.com:org/repo.git', branch: 'main'}}
    promptResponses = {
      [M.harnesses.select]: [],
      [M.source.addSource]: true,
      [M.source.selectType]: 'git',
      [M.sync.runNow]: false,
    }
    const {runInit} = await import('./handler')
    await runInit({verbose: false, force: false})
    const cfg = writtenConfig as {sources: Array<{url: string; type: string}>}
    expect(cfg.sources).toHaveLength(1)
    expect(cfg.sources[0].url).toBe('git@github.com:org/repo.git')
    expect(cfg.sources[0].type).toBe('git')
  })

  it('includes local source in config when user selects local type', async () => {
    mockSourceByType = {local: {name: 'default', type: 'local', path: '~/my-ai-configs'}}
    promptResponses = {
      [M.harnesses.select]: [],
      [M.source.addSource]: true,
      [M.source.selectType]: 'local',
      [M.sync.runNow]: false,
    }
    const {runInit} = await import('./handler')
    await runInit({verbose: false, force: false})
    const cfg = writtenConfig as {sources: Array<{path: string; type: string}>}
    expect(cfg.sources).toHaveLength(1)
    expect(cfg.sources[0].type).toBe('local')
    expect(cfg.sources[0].path).toBe('~/my-ai-configs')
  })

  it('writes multiple sources when user adds more than one', async () => {
    mockSourceByType = {
      git: {name: 'default', type: 'git', url: 'git@github.com:org/repo.git', branch: 'main'},
      local: {name: 'default', type: 'local', path: '~/local-configs'},
    }
    promptResponses = {
      [M.harnesses.select]: [],
      [M.source.addSource]: true,
      [M.source.selectType]: ['git', 'local'],
      [M.source.addAnother]: [true, false],
      [M.sync.runNow]: false,
    }
    const {runInit} = await import('./handler')
    await runInit({verbose: false, force: false})
    const cfg = writtenConfig as {sources: Array<{name: string; type: string}>}
    expect(cfg.sources).toHaveLength(2)
    expect(cfg.sources[0].name).toBe('default')
    expect(cfg.sources[0].type).toBe('git')
    expect(cfg.sources[1].name).toBe('source-2')
    expect(cfg.sources[1].type).toBe('local')
  })

  it('pre-selects detected harnesses and includes them when returned', async () => {
    mockDetectionResults = [
      {id: cursor.id, name: cursor.name, detected: true, scope: 'project'},
      {id: windsurf.id, name: windsurf.name, detected: false, scope: undefined},
    ]
    promptResponses = {[M.harnesses.select]: [cursor.id], [M.source.addSource]: false}
    const {runInit} = await import('./handler')
    await runInit({verbose: false, force: false})
    const harnesses = (writtenConfig as {harnesses: Array<{id: string; enabled: boolean}>}).harnesses
    expect(harnesses.find((a) => a.id === cursor.id)?.enabled).toBe(true)
  })

  it('excludes detected harness when user deselects it', async () => {
    mockDetectionResults = [
      {id: cursor.id, name: cursor.name, detected: true, scope: 'project'},
      {id: windsurf.id, name: windsurf.name, detected: false, scope: undefined},
    ]
    promptResponses = {[M.harnesses.select]: [], [M.source.addSource]: false}
    const {runInit} = await import('./handler')
    await runInit({verbose: false, force: false})
    const harnesses = (writtenConfig as {harnesses: Array<{id: string}>}).harnesses
    expect(harnesses.find((a) => a.id === cursor.id)).toBeUndefined()
  })

  it('aborts without writing when config already exists', async () => {
    mockConfigExists = true
    const {runInit} = await import('./handler')
    await runInit({verbose: false, force: false})
    expect(writtenConfig).toBeNull()
  })

  it('does not scan when config already exists', async () => {
    mockConfigExists = true
    const {runInit} = await import('./handler')
    await runInit({verbose: false, force: false})
    expect(scanCalled).toBe(false)
  })

  it('renders warning when no harnesses selected', async () => {
    promptResponses = {[M.harnesses.select]: [], [M.source.addSource]: false}
    const {runInit} = await import('./handler')
    await runInit({verbose: false, force: false})
    expect(rendererWarnings).toContain(M.harnesses.noneSelected)
  })

  it('proceeds to write when no existing config', async () => {
    mockConfigExists = false
    promptResponses = {
      [M.harnesses.select]: [],
      [M.source.addSource]: false,
    }
    const {runInit} = await import('./handler')
    await runInit({verbose: false, force: false})
    expect(writtenConfig).not.toBeNull()
  })

  it('overwrites existing config when --force is set', async () => {
    mockConfigExists = true
    promptResponses = {[M.harnesses.select]: [], [M.source.addSource]: false}
    const {runInit} = await import('./handler')
    await runInit({verbose: false, force: true})
    expect(writtenConfig).not.toBeNull()
  })

  it('uses project directory name as config project name', async () => {
    mockProjectRoot = '/workspace/my-app'
    promptResponses = {[M.harnesses.select]: [], [M.source.addSource]: false}
    const {runInit} = await import('./handler')
    await runInit({verbose: false, force: false})
    expect((writtenConfig as {project?: {name: string}}).project?.name).toBe('my-app')
  })
})
