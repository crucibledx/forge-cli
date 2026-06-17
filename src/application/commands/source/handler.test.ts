import {beforeEach, describe, expect, it, mock} from 'bun:test'

import type {SyncState} from '@domain/sync/state'

// ─── Mock state ─────────────────────────────────────────────────────────────

let rendererCalls: Array<{method: string; args: unknown[]}> = []
let mockConfig: unknown = {
  version: '1',
  assistants: [{id: 'claude-code', enabled: true}],
  sources: [
    {name: 'team-rules', type: 'local', path: '/tmp/source'},
    {name: 'org-standards', type: 'git', url: 'https://github.com/org/standards'},
  ],
}

const mockSyncState: SyncState = {
  lastSync: '2026-06-10T08:00:00.000Z',
  files: {
    '.claude/rules/deploy.md': {hash: 'abc', sourceName: 'team-rules'},
    '.claude/rules/test.md': {hash: 'def', sourceName: 'team-rules'},
    '.claude/rules/lint.md': {hash: 'ghi', sourceName: 'org-standards'},
  },
}

const track =
  (method: string) =>
  (...args: unknown[]) => {
    rendererCalls.push({method, args})
  }

const selectMock = mock(() => Promise.resolve('team-rules'))
const confirmMock = mock(() => Promise.resolve(true))
const writeProjectConfigMock = mock(() => Promise.resolve('/tmp/config'))
const writeSyncStateMock = mock(() => Promise.resolve())

// ─── Mocks ──────────────────────────────────────────────────────────────────

mock.module('@infrastructure/cli/renderer', () => ({
  renderHeader: track('renderHeader'),
  renderInfo: track('renderInfo'),
  renderDim: track('renderDim'),
  renderError: track('renderError'),
  renderWarning: track('renderWarning'),
  renderSuccess: track('renderSuccess'),
  renderNewline: track('renderNewline'),
}))

mock.module('@infrastructure/cli/prompts', () => ({
  select: selectMock,
  confirm: confirmMock,
  text: mock(() => Promise.resolve('new-source')),
}))

mock.module('@infrastructure/config', () => ({
  loadProjectConfig: async () => mockConfig,
  loadSyncState: async () => mockSyncState,
  writeProjectConfig: writeProjectConfigMock,
  writeSyncState: writeSyncStateMock,
}))

mock.module('@infrastructure/io', () => ({
  default: {
    resolveProjectRoot: () => '/tmp/project',
    buildContext: async () => ({projectRoot: '/tmp/project', projectConfig: mockConfig, globalConfig: null}),
  },
}))

mock.module('@infrastructure/logger', () => ({
  createFileLogger: () => ({info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, flush: () => {}}),
}))

mock.module('@infrastructure/source', () => ({
  getSourceLoaderOptions: () => [{value: 'local', label: 'Local directory'}],
  getSourceLoader: () => ({
    alias: 'local',
    label: 'Local',
    configure: async () => ({name: 'new-source', type: 'local', path: '/tmp/new'}),
    load: async () => ({localPath: '/tmp/new', fresh: true}),
  }),
}))

// source.cleanup is NOT mocked — pure functions, tested independently

// ─── Import after mocks ─────────────────────────────────────────────────────

const {runSourceList, runSourceAdd, runSourceRemove} = await import('./handler')

// ─── Tests ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  rendererCalls = []
  selectMock.mockClear()
  confirmMock.mockClear()
  writeProjectConfigMock.mockClear()
  writeSyncStateMock.mockClear()
  mockConfig = {
    version: '1',
    assistants: [{id: 'claude-code', enabled: true}],
    sources: [
      {name: 'team-rules', type: 'local', path: '/tmp/source'},
      {name: 'org-standards', type: 'git', url: 'https://github.com/org/standards'},
    ],
  }
})

describe('runSourceList', () => {
  it('renders source entries with file counts', async () => {
    await runSourceList()

    const methods = rendererCalls.map((c) => c.method)
    expect(methods).toContain('renderHeader')
    expect(methods).toContain('renderInfo')
    expect(methods).toContain('renderDim')
  })
})

describe('runSourceAdd', () => {
  it('writes updated config with new source', async () => {
    await runSourceAdd()

    expect(writeProjectConfigMock).toHaveBeenCalled()
    expect(rendererCalls.some((c) => c.method === 'renderSuccess')).toBe(true)
  })
})

describe('runSourceRemove', () => {
  it('removes source and cleans files when confirmed', async () => {
    await runSourceRemove()

    expect(selectMock).toHaveBeenCalled()
    expect(confirmMock).toHaveBeenCalledTimes(2) // confirm remove + confirm clean
    expect(writeProjectConfigMock).toHaveBeenCalled()
    expect(writeSyncStateMock).toHaveBeenCalled()
    expect(rendererCalls.some((c) => c.method === 'renderSuccess')).toBe(true)
  })
})
