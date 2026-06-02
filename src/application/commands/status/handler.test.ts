import {afterEach, beforeEach, describe, expect, it, mock} from 'bun:test'

import type {DriftSummary} from '@domain/sync/drift'
import {DRIFT_STATUSES} from '@domain/sync/drift'
import {emptySyncState} from '@domain/sync/state'
import {hashContent} from '@domain/sync/state'

import {STATUS_MESSAGES as M} from './messages'

// ─── Shared mock state ────────────────────────────────────────────────────────

let rendererCalls: Array<{method: string; args: unknown[]}> = []
let mockSyncState = emptySyncState()
let mockDiskContents: Record<string, string | null> = {}
let mockHasConfig = true

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
  renderSyncFile: track('renderSyncFile'),
  renderDriftFile: track('renderDriftFile'),
  renderHeader: track('renderHeader'),
  renderDetectionResults: track('renderDetectionResults'),
  renderOutputEntries: track('renderOutputEntries'),
}))

mock.module('@infrastructure/fs', () => ({
  applyMutations: async () => [],
  collectFiles: async () => [],
  readFileContent: async () => null,
  readDiskContents: async () => mockDiskContents,
  rollbackMutations: async () => {},
}))

mock.module('@infrastructure/config', () => ({
  loadSyncState: async () => mockSyncState,
  writeProjectConfig: async () => {},
  writeSyncState: async () => {},
}))

mock.module('@infrastructure/source', () => ({
  getSourceLoader: () => ({
    load: async () => {
      throw new Error('mock: source not available')
    },
  }),
}))

mock.module('@infrastructure/io', () => ({
  default: {
    resolveProjectRoot: () => '/fake',
    buildContext: async () => ({
      projectRoot: '/fake',
      projectConfig: mockHasConfig ? {assistants: [{id: 'claude-code', enabled: true}], sources: []} : null,
      hasProjectConfig: mockHasConfig,
    }),
  },
}))

// ─── Import after mocks ──────────────────────────────────────────────────────

const {runStatus} = await import('./handler')
const {displayDrift, formatTimeAgo} = await import('./display')

// ─── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  rendererCalls = []
  mockSyncState = emptySyncState()
  mockDiskContents = {}
  mockHasConfig = true
})

afterEach(() => {
  mock.restore()
})

describe('formatTimeAgo', () => {
  it('returns "just now" for recent timestamps', () => {
    const now = new Date().toISOString()
    expect(formatTimeAgo(now)).toBe('just now')
  })

  it('returns minutes for timestamps < 1 hour ago', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()
    expect(formatTimeAgo(fiveMinAgo)).toBe('5 minute(s) ago')
  })

  it('returns hours for timestamps < 1 day ago', () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()
    expect(formatTimeAgo(threeHoursAgo)).toBe('3 hour(s) ago')
  })

  it('returns days for timestamps >= 1 day ago', () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString()
    expect(formatTimeAgo(twoDaysAgo)).toBe('2 day(s) ago')
  })
})

describe('displayDrift', () => {
  it('renders "all in sync" when no files have drift', () => {
    const summary: DriftSummary = {lastSync: new Date().toISOString(), files: []}

    displayDrift(summary)

    const successCalls = rendererCalls.filter((c) => c.method === 'renderSuccess')
    expect(successCalls).toHaveLength(1)
    expect(successCalls[0].args[0]).toBe(M.output.allInSync)
  })

  it('renders drift files grouped by assistant', () => {
    const summary: DriftSummary = {
      lastSync: new Date().toISOString(),
      files: [
        {targetPath: '.claude/skills/a.md', sourceName: 'team', status: DRIFT_STATUSES.MODIFIED},
        {targetPath: '.claude/skills/b.md', sourceName: 'team', status: DRIFT_STATUSES.IN_SYNC},
      ],
    }

    displayDrift(summary)

    const driftCalls = rendererCalls.filter((c) => c.method === 'renderDriftFile')
    expect(driftCalls).toHaveLength(2)
    expect(driftCalls[0].args).toEqual(['.claude/skills/a.md', DRIFT_STATUSES.MODIFIED])
    expect(driftCalls[1].args).toEqual(['.claude/skills/b.md', DRIFT_STATUSES.IN_SYNC])
  })

  it('renders modified count warning', () => {
    const summary: DriftSummary = {
      lastSync: new Date().toISOString(),
      files: [{targetPath: '.claude/skills/a.md', sourceName: 'team', status: DRIFT_STATUSES.MODIFIED}],
    }

    displayDrift(summary)

    const warnings = rendererCalls.filter((c) => c.method === 'renderWarning')
    expect(warnings.some((w) => (w.args[0] as string).includes('1 file(s) modified'))).toBe(true)
  })

  it('renders deleted count warning', () => {
    const summary: DriftSummary = {
      lastSync: new Date().toISOString(),
      files: [{targetPath: '.claude/skills/a.md', sourceName: 'team', status: DRIFT_STATUSES.DELETED}],
    }

    displayDrift(summary)

    const warnings = rendererCalls.filter((c) => c.method === 'renderWarning')
    expect(warnings.some((w) => (w.args[0] as string).includes('1 file(s) deleted'))).toBe(true)
  })

  it('renders hint when drift exists', () => {
    const summary: DriftSummary = {
      lastSync: new Date().toISOString(),
      files: [{targetPath: '.claude/skills/a.md', sourceName: 'team', status: DRIFT_STATUSES.MODIFIED}],
    }

    displayDrift(summary)

    const dimCalls = rendererCalls.filter((c) => c.method === 'renderDim')
    expect(dimCalls.some((c) => (c.args[0] as string).includes('forge sync'))).toBe(true)
  })
})

describe('runStatus', () => {
  it('exits with error when no config found', async () => {
    mockHasConfig = false
    const exitMock = mock(() => {})
    const origExit = process.exit
    process.exit = exitMock as never

    await runStatus({} as never)

    expect(exitMock).toHaveBeenCalledWith(1)
    const errorCalls = rendererCalls.filter((c) => c.method === 'renderError')
    expect(errorCalls).toHaveLength(1)
    expect(errorCalls[0].args[0]).toBe(M.errors.noConfig)

    process.exit = origExit
  })

  it('warns when never synced', async () => {
    mockSyncState = emptySyncState()

    await runStatus({} as never)

    const warnings = rendererCalls.filter((c) => c.method === 'renderWarning')
    expect(warnings).toHaveLength(1)
    expect(warnings[0].args[0]).toBe(M.errors.neverSynced)
  })

  it('detects drift and renders display', async () => {
    mockSyncState = {
      lastSync: new Date().toISOString(),
      files: {
        '.claude/skills/a.md': {hash: hashContent('original'), sourceName: 'team'},
      },
    }
    mockDiskContents = {'.claude/skills/a.md': 'modified'}

    await runStatus({} as never)

    const driftCalls = rendererCalls.filter((c) => c.method === 'renderDriftFile')
    expect(driftCalls).toHaveLength(1)
    expect(driftCalls[0].args[1]).toBe(DRIFT_STATUSES.MODIFIED)
  })

  it('shows in_sync status when nothing changed', async () => {
    mockSyncState = {
      lastSync: new Date().toISOString(),
      files: {
        '.claude/skills/a.md': {hash: hashContent('same'), sourceName: 'team'},
      },
    }
    mockDiskContents = {'.claude/skills/a.md': 'same'}

    await runStatus({} as never)

    const driftCalls = rendererCalls.filter((c) => c.method === 'renderDriftFile')
    expect(driftCalls).toHaveLength(1)
    expect(driftCalls[0].args[1]).toBe(DRIFT_STATUSES.IN_SYNC)
    // No warnings rendered when everything is in sync
    const warnings = rendererCalls.filter((c) => c.method === 'renderWarning')
    expect(warnings).toHaveLength(0)
  })
})
