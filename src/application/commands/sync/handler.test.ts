import {mkdirSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {afterEach, beforeEach, describe, expect, it, mock} from 'bun:test'

import {SYNC_CONFIG_DEFAULTS} from '@domain/config/types'
import type {SyncState} from '@domain/sync/state'
import {emptySyncState} from '@domain/sync/state'
import type {ResolvedTarget, SyncFileSummary} from '@domain/sync/types'

import {CommandError} from '../types'
import {SYNC_MESSAGES as M} from './messages'

// ─── Shared mock state ────────────────────────────────────────────────────────

let rendererCalls: Array<{method: string; args: unknown[]}> = []
let mockApplied: Array<{mutation: unknown; success: boolean; error?: string}> = []
let writtenConfigs: unknown[] = []
let syncStatesWritten: unknown[] = []
let rollbackCalled = false

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
  renderHeader: track('renderHeader'),
  renderDetectionResults: track('renderDetectionResults'),
  renderOutputEntries: track('renderOutputEntries'),
  setSilent: () => {},
}))

mock.module('@infrastructure/fs', () => ({
  applyMutations: async () => mockApplied,
  collectFiles: async () => [],
  readFileContent: async (root: string, rel: string) => {
    const {existsSync} = await import('node:fs')
    const {readFile} = await import('node:fs/promises')
    const full = join(root, rel)
    if (!existsSync(full)) return null
    return readFile(full, 'utf-8')
  },
  readDiskContents: async () => ({}),
  rollbackMutations: async () => {
    rollbackCalled = true
  },
}))

mock.module('@infrastructure/config', () => ({
  loadSyncState: async () => emptySyncState(),
  writeProjectConfig: async (_root: string, config: unknown) => {
    writtenConfigs.push(config)
  },
  writeSyncState: async (_root: string, state: unknown) => {
    syncStatesWritten.push(state)
  },
}))

mock.module('@infrastructure/io', () => ({
  default: {
    resolveProjectRoot: () => '/fake',
    buildContext: async () => ({
      projectRoot: '/fake',
      projectConfig: null,
      hasProjectConfig: false,
    }),
  },
}))

mock.module('@infrastructure/source', () => ({
  getSourceLoader: () => ({
    load: async () => ({localPath: '/fake/source', fresh: true}),
  }),
}))

// ─── Dynamic import after mocks ──────────────────────────────────────────────

const {buildPlan, displayPlan, executePlan, validateConfig} = await import('./handler')

// ─── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  rendererCalls = []
  mockApplied = []
  writtenConfigs = []
  syncStatesWritten = []
  rollbackCalled = false
})

// ── validateConfig ───────────────────────────────────────────────────────────

describe('validateConfig', () => {
  it('does not throw when config is valid', () => {
    expect(() =>
      validateConfig({
        version: '1',
        assistants: [{id: 'cursor', enabled: true}],
        sources: [{name: 'test', type: 'local'}],
      }),
    ).not.toThrow()
  })

  it('throws CommandError when sources are empty', () => {
    expect(() => validateConfig({version: '1', assistants: [{id: 'cursor', enabled: true}], sources: []})).toThrow(
      CommandError,
    )
  })

  it('throws CommandError when all assistants are disabled', () => {
    expect(() =>
      validateConfig({
        version: '1',
        assistants: [{id: 'cursor', enabled: false}],
        sources: [{name: 'test', type: 'local'}],
      }),
    ).toThrow(CommandError)
  })
})

// ── buildPlan ────────────────────────────────────────────────────────────────

describe('buildPlan', () => {
  let tempDir: string
  const emptyState = emptySyncState()
  const defaultConfig = SYNC_CONFIG_DEFAULTS

  beforeEach(() => {
    tempDir = join(tmpdir(), `forge-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(tempDir, {recursive: true})
  })

  afterEach(() => {
    rmSync(tempDir, {recursive: true, force: true})
  })

  const target = (path: string, content: string): ResolvedTarget => ({
    sourcePath: `source/${path}`,
    targetPath: path,
    content,
    assistantId: 'claude-code',
    sourceName: 'test',
  })

  it('marks new files as "new" with file_write mutation', async () => {
    const resolved = [target('skills/deploy.md', '# Deploy')]
    const {summaries, mutations} = await buildPlan(tempDir, resolved, emptyState, defaultConfig)

    expect(summaries).toHaveLength(1)
    expect(summaries[0].status).toBe('new')
    expect(mutations).toHaveLength(1)
    expect(mutations[0]).toEqual({type: 'file_write', path: 'skills/deploy.md', content: '# Deploy'})
  })

  it('marks unchanged files as "no_change" with no mutation', async () => {
    const filePath = join(tempDir, 'skills/deploy.md')
    mkdirSync(join(tempDir, 'skills'), {recursive: true})
    writeFileSync(filePath, '# Deploy')

    const resolved = [target('skills/deploy.md', '# Deploy')]
    const {summaries, mutations} = await buildPlan(tempDir, resolved, emptyState, defaultConfig)

    expect(summaries[0].status).toBe('no_change')
    expect(mutations).toHaveLength(0)
  })

  it('marks changed files as "update" with file_write mutation', async () => {
    const filePath = join(tempDir, 'skills/deploy.md')
    mkdirSync(join(tempDir, 'skills'), {recursive: true})
    writeFileSync(filePath, '# Old content')

    const resolved = [target('skills/deploy.md', '# New content')]
    const {summaries, mutations} = await buildPlan(tempDir, resolved, emptyState, defaultConfig)

    expect(summaries[0].status).toBe('update')
    expect(mutations).toHaveLength(1)
  })

  it('handles multiple files with mixed statuses', async () => {
    mkdirSync(join(tempDir, 'skills'), {recursive: true})
    writeFileSync(join(tempDir, 'skills/existing.md'), '# Same')
    writeFileSync(join(tempDir, 'skills/changed.md'), '# Old')

    const resolved = [
      target('skills/existing.md', '# Same'),
      target('skills/changed.md', '# New'),
      target('skills/brand-new.md', '# Brand New'),
    ]
    const {summaries, mutations} = await buildPlan(tempDir, resolved, emptyState, defaultConfig)

    expect(summaries.map((s) => s.status)).toEqual(['no_change', 'update', 'new'])
    expect(mutations).toHaveLength(2)
  })

  it('catches per-file errors and marks them as "error"', async () => {
    // Create a directory where a file is expected — readFile will fail
    mkdirSync(join(tempDir, 'skills/deploy.md'), {recursive: true})

    const resolved = [target('skills/deploy.md', '# Deploy'), target('skills/ok.md', '# OK')]
    const {summaries, mutations} = await buildPlan(tempDir, resolved, emptyState, defaultConfig)

    expect(summaries[0].status).toBe('error')
    expect(summaries[0].error).toBeDefined()
    expect(summaries[1].status).toBe('new')
    expect(mutations).toHaveLength(1)
  })

  it('returns empty plan for empty resolved array', async () => {
    const {summaries, mutations} = await buildPlan(tempDir, [], emptyState, defaultConfig)

    expect(summaries).toHaveLength(0)
    expect(mutations).toHaveLength(0)
  })

  it('deletes stale files when keep_local is false', async () => {
    const stateWithStale: SyncState = {
      lastSync: new Date().toISOString(),
      files: {
        '.claude/skills/old.md': {hash: 'abc', sourceName: 'team'},
      },
    }
    const config = {...defaultConfig, keep_local: false}

    const {summaries, mutations} = await buildPlan(tempDir, [], stateWithStale, config)

    expect(summaries).toHaveLength(1)
    expect(summaries[0].status).toBe('deleted')
    expect(summaries[0].targetPath).toBe('.claude/skills/old.md')
    expect(mutations).toHaveLength(1)
    expect(mutations[0].type).toBe('file_delete')
  })

  it('keeps stale files when keep_local is true (default)', async () => {
    const stateWithStale: SyncState = {
      lastSync: new Date().toISOString(),
      files: {
        '.claude/skills/old.md': {hash: 'abc', sourceName: 'team'},
      },
    }

    const {summaries, mutations} = await buildPlan(tempDir, [], stateWithStale, defaultConfig)

    expect(summaries).toHaveLength(0)
    expect(mutations).toHaveLength(0)
  })

  it('does not delete files still present in resolved targets', async () => {
    const stateWithFile: SyncState = {
      lastSync: new Date().toISOString(),
      files: {
        'skills/deploy.md': {hash: 'abc', sourceName: 'team'},
      },
    }
    const config = {...defaultConfig, keep_local: false}
    const resolved = [target('skills/deploy.md', '# Deploy')]

    const {summaries} = await buildPlan(tempDir, resolved, stateWithFile, config)

    const deleted = summaries.filter((s) => s.status === 'deleted')
    expect(deleted).toHaveLength(0)
  })
})

// ── displayPlan ──────────────────────────────────────────────────────────────

describe('displayPlan', () => {
  const sources = [{name: 'team', type: 'local'}]
  const syncCfg = SYNC_CONFIG_DEFAULTS

  const summary = (status: SyncFileSummary['status']): SyncFileSummary => ({
    targetPath: '.claude/skills/test.md',
    sourcePath: 'skills/test.md',
    assistantId: 'claude-code',
    status,
  })

  it('renders dry-run header when dryRun is true', () => {
    displayPlan([summary('new')], sources, syncCfg, true)

    const infoCalls = rendererCalls.filter((c) => c.method === 'renderInfo')
    expect(infoCalls.some((c) => (c.args[0] as string).includes('team'))).toBe(true)
  })

  it('does not render dry-run header when dryRun is false', () => {
    displayPlan([summary('new')], sources, syncCfg, false)

    const infoCalls = rendererCalls.filter((c) => c.method === 'renderInfo')
    expect(infoCalls.some((c) => (c.args[0] as string).includes('Would sync'))).toBe(false)
  })

  it('renders error count when errors present', () => {
    displayPlan([summary('error'), summary('new')], sources, syncCfg, false)

    const warningCalls = rendererCalls.filter((c) => c.method === 'renderWarning')
    expect(warningCalls.some((c) => (c.args[0] as string).includes('1 file(s)'))).toBe(true)
  })

  it('does not render error count when no errors', () => {
    displayPlan([summary('new')], sources, syncCfg, false)

    const warningCalls = rendererCalls.filter((c) => c.method === 'renderWarning')
    expect(warningCalls).toHaveLength(0)
  })

  it('renders strategy banner', () => {
    displayPlan([summary('new')], sources, syncCfg, false)

    const dimCalls = rendererCalls.filter((c) => c.method === 'renderDim')
    expect(dimCalls.some((c) => (c.args[0] as string).includes('last-wins'))).toBe(true)
  })

  it('renders dry-run hint when dryRun is true', () => {
    displayPlan([summary('new')], sources, syncCfg, true)

    const dimCalls = rendererCalls.filter((c) => c.method === 'renderDim')
    expect(dimCalls.some((c) => c.args[0] === M.output.dryRunHint)).toBe(true)
  })
})

// ── executePlan ──────────────────────────────────────────────────────────────

describe('executePlan', () => {
  const context = {
    projectRoot: '/fake',
    projectConfig: {version: '1', assistants: [], sources: [{name: 'test', type: 'local'}]},
    hasProjectConfig: true,
  }

  const resolved = [
    {
      sourcePath: 'skills/a.md',
      targetPath: '.claude/skills/a.md',
      content: '#',
      assistantId: 'claude-code',
      sourceName: 'test',
    },
  ]

  it('writes sync state on success', async () => {
    mockApplied = [{mutation: {type: 'file_write', path: 'a.md', content: '#'}, success: true}]

    await executePlan('/fake', [{type: 'file_write', path: 'a.md', content: '#'}], resolved, context)

    expect(syncStatesWritten).toHaveLength(1)
    const state = syncStatesWritten[0] as {lastSync: string; files: Record<string, unknown>}
    expect(state.lastSync).toBeTruthy()
    expect(state.files['.claude/skills/a.md']).toBeDefined()
  })

  it('writes config with lastSync on success', async () => {
    mockApplied = [{mutation: {type: 'file_write', path: 'a.md', content: '#'}, success: true}]

    await executePlan('/fake', [{type: 'file_write', path: 'a.md', content: '#'}], resolved, context)

    expect(writtenConfigs).toHaveLength(1)
    expect((writtenConfigs[0] as {lastSync: string}).lastSync).toBeDefined()
  })

  it('renders success message', async () => {
    mockApplied = [{mutation: {type: 'file_write', path: 'a.md', content: '#'}, success: true}]

    await executePlan('/fake', [{type: 'file_write', path: 'a.md', content: '#'}], resolved, context)

    const successCalls = rendererCalls.filter((c) => c.method === 'renderSuccess')
    expect(successCalls).toHaveLength(1)
  })

  it('triggers rollback on failure and throws CommandError', async () => {
    mockApplied = [{mutation: {type: 'file_write', path: 'a.md', content: '#'}, success: false, error: 'EACCES'}]

    await expect(
      executePlan('/fake', [{type: 'file_write', path: 'a.md', content: '#'}], resolved, context),
    ).rejects.toThrow(CommandError)

    expect(rollbackCalled).toBe(true)
  })

  it('skips config write when projectConfig is null', async () => {
    mockApplied = [{mutation: {type: 'file_write', path: 'a.md', content: '#'}, success: true}]

    const noConfigContext = {...context, projectConfig: null}
    await executePlan('/fake', [{type: 'file_write', path: 'a.md', content: '#'}], resolved, noConfigContext)

    expect(writtenConfigs).toHaveLength(0)
  })
})
