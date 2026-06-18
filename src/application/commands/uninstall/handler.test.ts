import {beforeEach, describe, expect, it, mock} from 'bun:test'

import type {ProjectConfig} from '@domain/config/types'
import type {SyncState} from '@domain/sync/state'

// ─── Mock state ─────────────────────────────────────────────────────────────

let mockConfig: ProjectConfig | null = {
  version: '1',
  assistants: [{id: 'cursor', enabled: true}],
  sources: [{name: 'default', type: 'local', path: '/tmp/src'}],
}

const mockSyncState: SyncState = {
  lastSync: '2026-06-18T12:00:00Z',
  files: {
    '.claude/rules/deploy.md': {hash: 'abc', sourceName: 'default'},
  },
}

let rendererCalls: Array<{method: string; args: unknown[]}> = []
let confirmResponse = true
let schedulerInstalled = true
let schedulerUninstalled = false
let crucibleDirRemoved = false
let deletedFiles: string[] = []

const track =
  (method: string) =>
  (...args: unknown[]) => {
    rendererCalls.push({method, args})
  }

// ─── Mocks ──────────────────────────────────────────────────────────────────

mock.module('@infrastructure/cli/prompts', () => ({
  intro: track('intro'),
  outro: track('outro'),
  confirm: async () => confirmResponse,
}))

mock.module('@infrastructure/cli/renderer', () => ({
  renderError: track('renderError'),
  renderWarning: track('renderWarning'),
  renderSuccess: track('renderSuccess'),
  renderDim: track('renderDim'),
  renderNewline: track('renderNewline'),
}))

mock.module('@infrastructure/config', () => ({
  loadProjectConfig: async () => mockConfig,
  loadSyncState: async () => mockSyncState,
  removeCrucibleDir: async () => {
    crucibleDirRemoved = true
  },
}))

mock.module('@infrastructure/io', () => ({
  default: {resolveProjectRoot: () => '/tmp/project'},
}))

mock.module('@infrastructure/logger', () => ({
  createFileLogger: () => ({info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, flush: () => {}}),
}))

mock.module('@infrastructure/scheduler', () => ({
  getSchedulerBackend: () => ({
    isInstalled: async () => schedulerInstalled,
    uninstall: async () => {
      schedulerUninstalled = true
    },
  }),
}))

mock.module('../shared/source.cleanup', () => ({
  deleteSourceFiles: async (_root: string, files: string[]) => {
    deletedFiles = files
    return {cleaned: files.length, errors: 0}
  },
}))

// ─── Import after mocks ─────────────────────────────────────────────────────

const {runUninstall} = await import('./handler')

// ─── Tests ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  rendererCalls = []
  confirmResponse = true
  schedulerInstalled = true
  schedulerUninstalled = false
  crucibleDirRemoved = false
  deletedFiles = []
  mockConfig = {
    version: '1',
    assistants: [{id: 'cursor', enabled: true}],
    sources: [{name: 'default', type: 'local', path: '/tmp/src'}],
  }
})

describe('runUninstall', () => {
  it('removes scheduler, synced files, and .crucible dir when confirmed', async () => {
    await runUninstall()

    expect(schedulerUninstalled).toBe(true)
    expect(deletedFiles).toEqual(['.claude/rules/deploy.md'])
    expect(crucibleDirRemoved).toBe(true)
    const methods = rendererCalls.map((c) => c.method)
    expect(methods.filter((m) => m === 'renderSuccess').length).toBeGreaterThanOrEqual(3)
  })

  it('does nothing when user declines confirmation', async () => {
    confirmResponse = false
    await runUninstall()

    expect(schedulerUninstalled).toBe(false)
    expect(crucibleDirRemoved).toBe(false)
    expect(rendererCalls.some((c) => c.method === 'outro' && String(c.args[0]).includes('cancelled'))).toBe(true)
  })

  it('skips scheduler when not installed', async () => {
    schedulerInstalled = false
    await runUninstall()

    expect(schedulerUninstalled).toBe(false)
    expect(crucibleDirRemoved).toBe(true)
  })
})
