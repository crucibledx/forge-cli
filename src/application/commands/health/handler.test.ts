import {afterEach, beforeEach, describe, expect, it, mock} from 'bun:test'

import {emptySyncState} from '@domain/sync/state'

import {HEALTH_MESSAGES as M} from './messages'

// ─── Shared mock state ────────────────────────────────────────────────────────

let rendererCalls: Array<{method: string; args: unknown[]}> = []
let mockHasConfig = true
let mockLatestReport: unknown = null

const track =
  (method: string) =>
  (...args: unknown[]) => {
    rendererCalls.push({method, args})
  }

// ─── Mocks ────────────────────────────────────────────────────────────────────

mock.module('@infrastructure/cli/renderer', () => ({
  render: track('render'),
  renderNewline: track('renderNewline'),
  renderInfo: track('renderInfo'),
  renderWarning: track('renderWarning'),
  renderError: track('renderError'),
  renderSuccess: track('renderSuccess'),
  renderDim: track('renderDim'),
  renderHeader: track('renderHeader'),
  renderSyncFile: track('renderSyncFile'),
  renderDriftFile: track('renderDriftFile'),
  renderDetectionResults: track('renderDetectionResults'),
  renderOutputEntries: track('renderOutputEntries'),
}))

mock.module('@infrastructure/config', () => ({
  loadSyncState: async () => emptySyncState(),
  writeProjectConfig: async () => {},
  writeSyncState: async () => {},
}))

mock.module('@infrastructure/fs', () => ({
  readDiskContents: async () => ({}),
}))

mock.module('@infrastructure/io', () => ({
  default: {
    resolveProjectRoot: () => '/fake',
    buildContext: async () => ({
      projectRoot: '/fake',
      projectConfig: mockHasConfig
        ? {assistants: [{id: 'claude-code', enabled: true}], sources: [], sync: {schedule: '0 9 * * 1'}}
        : null,
      hasProjectConfig: mockHasConfig,
    }),
  },
}))

mock.module('@infrastructure/logger', () => ({
  getLogDir: () => '/fake/.crucible/forge/logs',
  createFileLogger: () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    trace: () => {},
    flush: () => {},
    rotate: async () => {},
    readRecent: async () => [],
    getLogDir: () => '/fake/.crucible/forge/logs',
  }),
}))

mock.module('@infrastructure/report', () => ({
  createReportService: () => ({
    readLatest: async () => mockLatestReport,
    readHistory: async () => (mockLatestReport ? [mockLatestReport] : []),
    writeReport: async () => {},
    rotate: async () => {},
    getReportDir: () => '/fake/.crucible/forge/reports',
  }),
}))

mock.module('@infrastructure/scheduler', () => ({
  getSchedulerBackend: () => ({
    isInstalled: async () => false,
    install: async () => {},
    uninstall: async () => {},
    getJobTitle: () => 'forge-sync-fake',
  }),
}))

mock.module('@infrastructure/source', () => ({
  getSourceLoader: () => ({
    load: async () => {
      throw new Error('not reachable')
    },
  }),
}))

// ─── Import after mocks ──────────────────────────────────────────────────────

const {runHealth} = await import('./handler')

// ─── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  rendererCalls = []
  mockHasConfig = true
  mockLatestReport = null
})

afterEach(() => {
  mock.restore()
})

describe('runHealth', () => {
  it('exits with error when no config found', async () => {
    mockHasConfig = false
    const exitMock = mock(() => {})
    const origExit = process.exit
    process.exit = exitMock as never

    await runHealth({} as never)

    expect(exitMock).toHaveBeenCalledWith(1)
    const errorCalls = rendererCalls.filter((c) => c.method === 'renderError')
    expect(errorCalls).toHaveLength(1)

    process.exit = origExit
  })

  it('shows "never" when no report exists', async () => {
    await runHealth({} as never)

    const dimCalls = rendererCalls.filter((c) => c.method === 'renderDim')
    expect(dimCalls.some((c) => (c.args[0] as string).includes('never'))).toBe(true)
  })

  it('shows last sync time when report exists', async () => {
    mockLatestReport = {
      timestamp: new Date().toISOString(),
      success: true,
      files: {synced: 5},
      drift: {detected: false},
    }

    await runHealth({} as never)

    const dimCalls = rendererCalls.filter((c) => c.method === 'renderDim')
    expect(dimCalls.some((c) => (c.args[0] as string).includes('just now'))).toBe(true)
  })

  it('renders header', async () => {
    await runHealth({} as never)

    const headerCalls = rendererCalls.filter((c) => c.method === 'renderHeader')
    expect(headerCalls).toHaveLength(1)
    expect(headerCalls[0].args[0]).toBe(M.header)
  })

  it('shows sources and assistants', async () => {
    await runHealth({} as never)

    const dimCalls = rendererCalls.filter((c) => c.method === 'renderDim')
    expect(dimCalls.some((c) => (c.args[0] as string).includes('0 configured'))).toBe(true)
    expect(dimCalls.some((c) => (c.args[0] as string).includes('claude-code'))).toBe(true)
  })
})
