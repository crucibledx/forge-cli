import {afterEach, beforeEach, describe, expect, it, mock} from 'bun:test'

import {CommandError} from '../types'
import {SCHEDULER_MESSAGES as M} from './messages'

// ─── Shared mock state ────────────────────────────────────────────────────────

let rendererCalls: Array<{method: string; args: unknown[]}> = []
let promptResponses: Record<string, unknown> = {}
let mockHasConfig = true
let mockSchedule: string | undefined = '0 9 * * 1'
let mockIsInstalled = false
let mockInstallError: Error | null = null
let mockUninstallError: Error | null = null
let mockLogEntries: Array<{ts: string; level: string; msg: string}> = []
let mockWrittenConfig: unknown = null
let mockPromptScheduleResult: string | undefined = '0 9 * * 1'

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

mock.module('@infrastructure/cli/prompts', () => ({
  intro: track('intro'),
  outro: track('outro'),
  select: async (opts: {message: string}) => {
    const val = promptResponses[opts.message]
    if (Array.isArray(val)) return val.shift() ?? ''
    return val ?? ''
  },
  confirm: async (opts: {message: string}) => {
    const val = promptResponses[opts.message]
    if (Array.isArray(val)) return val.shift() ?? false
    return val ?? false
  },
  text: async (opts: {message: string; defaultValue?: string}) => {
    const val = promptResponses[opts.message]
    return (val as string) ?? opts.defaultValue ?? ''
  },
}))

mock.module('@infrastructure/config', () => ({
  loadProjectConfig: async () =>
    mockHasConfig
      ? {
          assistants: [{id: 'claude-code', enabled: true}],
          sources: [],
          sync: mockSchedule ? {schedule: mockSchedule} : {},
        }
      : null,
  writeProjectConfig: async (_root: string, config: unknown) => {
    mockWrittenConfig = config
    return '/fake/project/.crucible/forge.config.yaml'
  },
}))

mock.module('../shared/scheduler.prompt', () => ({
  promptSchedule: async () => mockPromptScheduleResult,
  SCHEDULER_PROMPT_MESSAGES: {
    enableSchedule: 'Set up automatic sync schedule?',
    enterCron: 'Enter cron expression:',
    enterCronEdit: 'Enter new cron expression:',
    cronPlaceholder: '0 9 * * 1',
    invalidCron: 'Invalid cron expression.',
    schedulePreview: (desc: string) => `→ ${desc}`,
    confirmSchedule: 'Use this schedule?',
  },
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
  createFileLogger: () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    trace: () => {},
    readRecent: async () => mockLogEntries,
    rotate: async () => {},
    getLogDir: () => '/fake/.crucible/forge/logs',
    flush: () => {},
  }),
  getLogDir: () => '/fake/.crucible/forge/logs',
  LOG_LEVELS: {SILENT: 'silent', ERROR: 'error', WARN: 'warn', INFO: 'info', DEBUG: 'debug', TRACE: 'trace'},
}))

// ─── Import after mocks ──────────────────────────────────────────────────────

const {runScheduler, runSchedulerInstall, runSchedulerUninstall, runSchedulerStatus} = await import('./handler')

// ─── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  rendererCalls = []
  promptResponses = {}
  mockHasConfig = true
  mockSchedule = '0 9 * * 1'
  mockIsInstalled = false
  mockInstallError = null
  mockUninstallError = null
  mockLogEntries = []
  mockWrittenConfig = null
  mockPromptScheduleResult = '0 9 * * 1'
})

afterEach(() => {
  mock.restore()
})

describe('runSchedulerInstall', () => {
  it('throws CommandError when no config found', async () => {
    mockHasConfig = false
    await expect(runSchedulerInstall()).rejects.toThrow(CommandError)
  })

  it('throws CommandError when no schedule configured', async () => {
    mockSchedule = undefined
    await expect(runSchedulerInstall()).rejects.toThrow(CommandError)
  })

  it('throws CommandError for invalid cron expression', async () => {
    mockSchedule = 'not-valid'
    await expect(runSchedulerInstall()).rejects.toThrow(CommandError)
  })

  it('installs successfully with valid schedule', async () => {
    await runSchedulerInstall()

    const successCalls = rendererCalls.filter((c) => c.method === 'renderSuccess')
    expect(successCalls).toHaveLength(1)
    expect(successCalls[0].args[0]).toContain('Scheduler installed')
  })

  it('throws CommandError when backend install fails', async () => {
    mockInstallError = new Error('permission denied')
    await expect(runSchedulerInstall()).rejects.toThrow(CommandError)
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

  it('throws CommandError when backend uninstall fails', async () => {
    mockIsInstalled = true
    mockUninstallError = new Error('unload failed')
    await expect(runSchedulerUninstall()).rejects.toThrow(CommandError)
  })
})

describe('runSchedulerStatus', () => {
  it('throws CommandError when no config found', async () => {
    mockHasConfig = false
    await expect(runSchedulerStatus()).rejects.toThrow(CommandError)
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
    mockLogEntries = [{ts: '2026-06-03T09:00:00.000Z', level: 'info', msg: 'Sync completed'}]

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

describe('runScheduler (interactive)', () => {
  it('shows intro and status on start', async () => {
    promptResponses = {[M.selectAction]: 'done'}

    await runScheduler()

    const introCalls = rendererCalls.filter((c) => c.method === 'intro')
    expect(introCalls).toHaveLength(1)
    expect(introCalls[0].args[0]).toBe(M.intro)

    // status is shown (not installed)
    const infoCalls = rendererCalls.filter((c) => c.method === 'renderInfo')
    expect(infoCalls.some((c) => (c.args[0] as string).includes('not installed'))).toBe(true)
  })

  it('exits when Done is selected', async () => {
    promptResponses = {[M.selectAction]: 'done'}

    await runScheduler()

    const outroCalls = rendererCalls.filter((c) => c.method === 'outro')
    expect(outroCalls).toHaveLength(1)
  })

  it('runs change schedule and writes config', async () => {
    mockPromptScheduleResult = '30 8 * * *'
    promptResponses = {
      [M.selectAction]: 'change',
      [M.changeAnother]: false,
    }

    await runScheduler()

    const successCalls = rendererCalls.filter((c) => c.method === 'renderSuccess')
    expect(successCalls.some((c) => (c.args[0] as string).includes('updated'))).toBe(true)
    expect((mockWrittenConfig as {sync: {schedule: string}}).sync.schedule).toBe('30 8 * * *')
  })

  it('loops when user confirms "anything else"', async () => {
    mockPromptScheduleResult = '30 8 * * *'
    promptResponses = {
      [M.selectAction]: ['change', 'done'],
      [M.changeAnother]: true,
    }

    await runScheduler()

    const successCalls = rendererCalls.filter((c) => c.method === 'renderSuccess')
    expect(successCalls.some((c) => (c.args[0] as string).includes('updated'))).toBe(true)
  })
})
