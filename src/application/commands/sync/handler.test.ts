import {mkdirSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {afterEach, beforeEach, describe, expect, it, mock} from 'bun:test'

import type {ResolvedTarget, SyncFileSummary} from '@domain/sync/types'

import {SYNC_MESSAGES as M} from './messages'

// ─── Shared mock state ────────────────────────────────────────────────────────

let rendererCalls: Array<{method: string; args: unknown[]}> = []
let mockApplied: Array<{mutation: unknown; success: boolean; error?: string}> = []
let writtenConfigs: unknown[] = []
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
}))

mock.module('@infrastructure/fs', () => ({
  applyMutations: async () => mockApplied,
  collectFiles: async () => [],
  rollbackMutations: async () => {
    rollbackCalled = true
  },
}))

mock.module('@infrastructure/config', () => ({
  writeProjectConfig: async (_root: string, config: unknown) => {
    writtenConfigs.push(config)
  },
}))

mock.module('@infrastructure/io', () => ({
  default: {
    resolveProjectRoot: () => '/fake',
    buildContext: async () => ({
      projectRoot: '/fake',
      globalConfig: null,
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
  rollbackCalled = false
})

// ── validateConfig ───────────────────────────────────────────────────────────

describe('validateConfig', () => {
  it('does not exit when config is valid', () => {
    const exitMock = mock(() => {})
    const origExit = process.exit
    process.exit = exitMock as never

    validateConfig({
      version: '1',
      assistants: [{id: 'cursor', enabled: true}],
      sources: [{name: 'test', type: 'local'}],
    })

    expect(exitMock).not.toHaveBeenCalled()
    process.exit = origExit
  })

  it('exits when sources are empty', () => {
    const exitMock = mock(() => {})
    const origExit = process.exit
    process.exit = exitMock as never

    validateConfig({version: '1', assistants: [{id: 'cursor', enabled: true}], sources: []})

    expect(exitMock).toHaveBeenCalledWith(1)
    process.exit = origExit
  })

  it('exits when all assistants are disabled', () => {
    const exitMock = mock(() => {})
    const origExit = process.exit
    process.exit = exitMock as never

    validateConfig({
      version: '1',
      assistants: [{id: 'cursor', enabled: false}],
      sources: [{name: 'test', type: 'local'}],
    })

    expect(exitMock).toHaveBeenCalledWith(1)
    process.exit = origExit
  })
})

// ── buildPlan ────────────────────────────────────────────────────────────────

describe('buildPlan', () => {
  let tempDir: string

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
  })

  it('marks new files as "new" with file_write mutation', async () => {
    const resolved = [target('skills/deploy.md', '# Deploy')]
    const {summaries, mutations} = await buildPlan(tempDir, resolved)

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
    const {summaries, mutations} = await buildPlan(tempDir, resolved)

    expect(summaries[0].status).toBe('no_change')
    expect(mutations).toHaveLength(0)
  })

  it('marks changed files as "update" with file_write mutation', async () => {
    const filePath = join(tempDir, 'skills/deploy.md')
    mkdirSync(join(tempDir, 'skills'), {recursive: true})
    writeFileSync(filePath, '# Old content')

    const resolved = [target('skills/deploy.md', '# New content')]
    const {summaries, mutations} = await buildPlan(tempDir, resolved)

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
    const {summaries, mutations} = await buildPlan(tempDir, resolved)

    expect(summaries.map((s) => s.status)).toEqual(['no_change', 'update', 'new'])
    expect(mutations).toHaveLength(2)
  })

  it('catches per-file errors and marks them as "error"', async () => {
    // Create a directory where a file is expected — readFile will fail
    mkdirSync(join(tempDir, 'skills/deploy.md'), {recursive: true})

    const resolved = [target('skills/deploy.md', '# Deploy'), target('skills/ok.md', '# OK')]
    const {summaries, mutations} = await buildPlan(tempDir, resolved)

    expect(summaries[0].status).toBe('error')
    expect(summaries[0].error).toBeDefined()
    expect(summaries[1].status).toBe('new')
    expect(mutations).toHaveLength(1)
  })

  it('returns empty plan for empty resolved array', async () => {
    const {summaries, mutations} = await buildPlan(tempDir, [])

    expect(summaries).toHaveLength(0)
    expect(mutations).toHaveLength(0)
  })
})

// ── displayPlan ──────────────────────────────────────────────────────────────

describe('displayPlan', () => {
  const sources = [{name: 'team', type: 'local'}]

  const summary = (status: SyncFileSummary['status']): SyncFileSummary => ({
    targetPath: '.claude/skills/test.md',
    sourcePath: 'skills/test.md',
    assistantId: 'claude-code',
    status,
  })

  it('renders dry-run header when dryRun is true', () => {
    displayPlan([summary('new')], sources, true)

    const infoCalls = rendererCalls.filter((c) => c.method === 'renderInfo')
    expect(infoCalls.some((c) => (c.args[0] as string).includes('team'))).toBe(true)
  })

  it('does not render dry-run header when dryRun is false', () => {
    displayPlan([summary('new')], sources, false)

    const infoCalls = rendererCalls.filter((c) => c.method === 'renderInfo')
    expect(infoCalls.some((c) => (c.args[0] as string).includes('Would sync'))).toBe(false)
  })

  it('renders error count when errors present', () => {
    displayPlan([summary('error'), summary('new')], sources, false)

    const warningCalls = rendererCalls.filter((c) => c.method === 'renderWarning')
    expect(warningCalls.some((c) => (c.args[0] as string).includes('1 file(s)'))).toBe(true)
  })

  it('does not render error count when no errors', () => {
    displayPlan([summary('new')], sources, false)

    const warningCalls = rendererCalls.filter((c) => c.method === 'renderWarning')
    expect(warningCalls).toHaveLength(0)
  })

  it('renders dry-run hint when dryRun is true', () => {
    displayPlan([summary('new')], sources, true)

    const dimCalls = rendererCalls.filter((c) => c.method === 'renderDim')
    expect(dimCalls.some((c) => c.args[0] === M.output.dryRunHint)).toBe(true)
  })
})

// ── executePlan ──────────────────────────────────────────────────────────────

describe('executePlan', () => {
  const context = {
    projectRoot: '/fake',
    globalConfig: null,
    projectConfig: {version: '1', assistants: [], sources: [{name: 'test', type: 'local'}]},
    hasProjectConfig: true,
  }

  it('writes config with lastSync on success', async () => {
    mockApplied = [{mutation: {type: 'file_write', path: 'a.md', content: '#'}, success: true}]

    await executePlan('/fake', [{type: 'file_write', path: 'a.md', content: '#'}], context)

    expect(writtenConfigs).toHaveLength(1)
    expect((writtenConfigs[0] as {lastSync: string}).lastSync).toBeDefined()
  })

  it('renders success message', async () => {
    mockApplied = [{mutation: {type: 'file_write', path: 'a.md', content: '#'}, success: true}]

    await executePlan('/fake', [{type: 'file_write', path: 'a.md', content: '#'}], context)

    const successCalls = rendererCalls.filter((c) => c.method === 'renderSuccess')
    expect(successCalls).toHaveLength(1)
  })

  it('triggers rollback on failure and exits', async () => {
    mockApplied = [{mutation: {type: 'file_write', path: 'a.md', content: '#'}, success: false, error: 'EACCES'}]

    const exitMock = mock(() => {})
    const origExit = process.exit
    process.exit = exitMock as never

    await executePlan('/fake', [{type: 'file_write', path: 'a.md', content: '#'}], context)

    expect(rollbackCalled).toBe(true)
    expect(exitMock).toHaveBeenCalledWith(1)
    process.exit = origExit
  })

  it('skips config write when projectConfig is null', async () => {
    mockApplied = [{mutation: {type: 'file_write', path: 'a.md', content: '#'}, success: true}]

    const noConfigContext = {...context, projectConfig: null}
    await executePlan('/fake', [{type: 'file_write', path: 'a.md', content: '#'}], noConfigContext)

    expect(writtenConfigs).toHaveLength(0)
  })
})
