import {afterEach, beforeEach, describe, expect, it, mock} from 'bun:test'

import {SCHEDULER_MESSAGES as M} from './messages'

// ─── Shared mock state ────────────────────────────────────────────────────────

let rendererCalls: Array<{method: string; args: unknown[]}> = []
let mockHasConfig = true
let mockSchedule: string | undefined = '0 9 * * 1'
let mockIsInstalled = false
let mockInstallError: Error | null = null
let mockUninstallError: Error | null = null
let mockLogEntries: Array<{timestamp: string; level: string; message: string}> = []

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
}))

mock.module('@infrastructure/io', () => ({
  default: {
    resolveProjectRoot: () => '/fake/project',
    buildContext: async () => ({
      projectRoot: '/fake/project',
      projectConfig: mockHasConfig
        ? {
            assistants: [{id: 'claude-code', enabled: true}],
            sources: [],
            sync: mockSchedule ? {schedule: mockSchedule} : {},
          }
        : null,
      hasProjectConfig: mockHasConfig,
    }),
  },
}))

mock.module('@infrastructure/scheduler', () => ({
  getSchedulerBackend: () => ({
    install: async () => {
      if (mockInstallError) throw mockInstallError
    },
    uninstall: async () => {
      if (mockUninstallError) throw mockUninstallError
    },
    isInstalled: async () => mockIsInstalled,
    getJobTitle: () => 'crucible-forge-sync-fake-project',
  }),
}))

mock.module('@infrastructure/logger', () => ({
  createSchedulerLogger: () => ({
    info: async () => {},
    warn: async () => {},
    error: async () => {},
    readRecent: async () => mockLogEntries,
    getLogPath: () => '/fake/.crucible/logs/scheduled/forge.sync.log',
  }),
  getLogPath: () => '/fake/.crucible/logs/scheduled/forge.sync.log',
  LOG_LEVELS: {INFO: 'INFO', WARN: 'WARN', ERROR: 'ERROR'},
}))

// ─── Import after mocks ──────────────────────────────────────────────────────

const {runSchedulerInstall, runSchedulerUninstall, runSchedulerStatus} = await import('./handler')

// ─── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  rendererCalls = []
  mockHasConfig = true
  mockSchedule = '0 9 * * 1'
  mockIsInstalled = false
  mockInstallError = null
  mockUninstallError = null
  mockLogEntries = []
})

afterEach(() => {
  mock.restore()
})

describe('runSchedulerInstall', () => {
  it('exits with error when no config found', async () => {
    mockHasConfig = false
    const origExit = process.exit
    process.exit = (() => {
      throw new Error('EXIT')
    }) as never

    await expect(runSchedulerInstall()).rejects.toThrow('EXIT')

    const errorCalls = rendererCalls.filter((c) => c.method === 'renderError')
    expect(errorCalls).toHaveLength(1)
    expect(errorCalls[0].args[0]).toBe(M.errors.noConfig)

    process.exit = origExit
  })

  it('exits with error when no schedule configured', async () => {
    mockSchedule = undefined
    const origExit = process.exit
    process.exit = (() => {
      throw new Error('EXIT')
    }) as never

    await expect(runSchedulerInstall()).rejects.toThrow('EXIT')

    const errorCalls = rendererCalls.filter((c) => c.method === 'renderError')
    expect(errorCalls).toHaveLength(1)
    expect(errorCalls[0].args[0]).toBe(M.errors.noSchedule)

    process.exit = origExit
  })

  it('exits with error for invalid cron expression', async () => {
    mockSchedule = 'not-valid'
    const origExit = process.exit
    process.exit = (() => {
      throw new Error('EXIT')
    }) as never

    await expect(runSchedulerInstall()).rejects.toThrow('EXIT')

    const errorCalls = rendererCalls.filter((c) => c.method === 'renderError')
    expect(errorCalls[0].args[0]).toContain('Invalid cron expression')

    process.exit = origExit
  })

  it('installs successfully with valid schedule', async () => {
    await runSchedulerInstall()

    const successCalls = rendererCalls.filter((c) => c.method === 'renderSuccess')
    expect(successCalls).toHaveLength(1)
    expect(successCalls[0].args[0]).toContain('Scheduler installed')
  })

  it('exits with error when backend install fails', async () => {
    mockInstallError = new Error('permission denied')
    const origExit = process.exit
    process.exit = (() => {
      throw new Error('EXIT')
    }) as never

    await expect(runSchedulerInstall()).rejects.toThrow('EXIT')

    const errorCalls = rendererCalls.filter((c) => c.method === 'renderError')
    expect(errorCalls[0].args[0]).toContain('permission denied')

    process.exit = origExit
  })
})

describe('runSchedulerUninstall', () => {
  it('reports not installed when no job exists', async () => {
    mockIsInstalled = false

    await runSchedulerUninstall()

    const infoCalls = rendererCalls.filter((c) => c.method === 'renderInfo')
    expect(infoCalls).toHaveLength(1)
    expect(infoCalls[0].args[0]).toBe(M.output.notInstalled)
  })

  it('uninstalls successfully when job exists', async () => {
    mockIsInstalled = true

    await runSchedulerUninstall()

    const successCalls = rendererCalls.filter((c) => c.method === 'renderSuccess')
    expect(successCalls).toHaveLength(1)
    expect(successCalls[0].args[0]).toBe(M.output.uninstalled)
  })

  it('exits with error when backend uninstall fails', async () => {
    mockIsInstalled = true
    mockUninstallError = new Error('unload failed')
    const origExit = process.exit
    process.exit = (() => {
      throw new Error('EXIT')
    }) as never

    await expect(runSchedulerUninstall()).rejects.toThrow('EXIT')

    const errorCalls = rendererCalls.filter((c) => c.method === 'renderError')
    expect(errorCalls[0].args[0]).toContain('unload failed')

    process.exit = origExit
  })
})

describe('runSchedulerStatus', () => {
  it('exits with error when no config found', async () => {
    mockHasConfig = false
    const origExit = process.exit
    process.exit = (() => {
      throw new Error('EXIT')
    }) as never

    await expect(runSchedulerStatus()).rejects.toThrow('EXIT')

    const errorCalls = rendererCalls.filter((c) => c.method === 'renderError')
    expect(errorCalls[0].args[0]).toBe(M.errors.noConfig)

    process.exit = origExit
  })

  it('shows not installed when no job exists', async () => {
    mockIsInstalled = false

    await runSchedulerStatus()

    const infoCalls = rendererCalls.filter((c) => c.method === 'renderInfo')
    expect(infoCalls.some((c) => (c.args[0] as string).includes('not installed'))).toBe(true)
  })

  it('shows installed status with schedule', async () => {
    mockIsInstalled = true

    await runSchedulerStatus()

    const successCalls = rendererCalls.filter((c) => c.method === 'renderSuccess')
    expect(successCalls[0].args[0]).toContain('installed')

    const dimCalls = rendererCalls.filter((c) => c.method === 'renderDim')
    expect(dimCalls.some((c) => (c.args[0] as string).includes('Schedule:'))).toBe(true)
  })

  it('shows last run info when log entries exist', async () => {
    mockIsInstalled = true
    mockLogEntries = [{timestamp: '2026-06-03T09:00:00.000Z', level: 'INFO', message: 'Sync completed'}]

    await runSchedulerStatus()

    const dimCalls = rendererCalls.filter((c) => c.method === 'renderDim')
    expect(dimCalls.some((c) => (c.args[0] as string).includes('Last run:'))).toBe(true)
  })

  it('shows "never" when no log entries exist', async () => {
    mockIsInstalled = true
    mockLogEntries = []

    await runSchedulerStatus()

    const dimCalls = rendererCalls.filter((c) => c.method === 'renderDim')
    expect(dimCalls.some((c) => (c.args[0] as string).includes('never'))).toBe(true)
  })
})
