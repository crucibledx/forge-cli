import {beforeEach, describe, expect, it, mock} from 'bun:test'

import type {ProjectConfig} from '@domain/config/types'

import {SCHEDULER_SECTION_MESSAGES as M} from './scheduler'

// ─── Mock state ──────────────────────────────────────────────────────────────

let promptResponses: Record<string, unknown> = {}
let rendererCalls: Array<{method: string; args: unknown[]}> = []
let mockScheduleResult: string | undefined

const track =
  (method: string) =>
  (...args: unknown[]) => {
    rendererCalls.push({method, args})
  }

// ─── Mocks ───────────────────────────────────────────────────────────────────

mock.module('@infrastructure/cli/renderer', () => ({
  renderNewline: track('renderNewline'),
  renderWarning: track('renderWarning'),
  renderSuccess: track('renderSuccess'),
  renderDim: track('renderDim'),
}))

mock.module('@infrastructure/cli/prompts', () => ({
  select: async (opts: {message: string}) => {
    const val = promptResponses[opts.message]
    if (Array.isArray(val)) return val.shift() ?? ''
    return val ?? ''
  },
  text: async (opts: {message: string; defaultValue?: string}) => {
    const val = promptResponses[opts.message]
    return (val as string) ?? opts.defaultValue ?? ''
  },
  confirm: async (opts: {message: string}) => {
    const val = promptResponses[opts.message]
    return (val as boolean) ?? false
  },
}))

mock.module('@application/commands/shared/scheduler.prompt', () => ({
  promptSchedule: async () => mockScheduleResult,
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

// ─── Reset ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  promptResponses = {}
  rendererCalls = []
  mockScheduleResult = undefined
})

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('schedulerSection', () => {
  const baseConfig: ProjectConfig = {version: '1', assistants: [], sources: []}

  it('hint returns "not configured" when no schedule', async () => {
    const {schedulerSection} = await import('./scheduler')
    expect(schedulerSection.hint(baseConfig)).toBe(M.hintNone)
  })

  it('hint returns human-readable description when schedule exists', async () => {
    const {schedulerSection} = await import('./scheduler')
    const config: ProjectConfig = {...baseConfig, sync: {schedule: '0 9 * * 1'}}
    const hint = schedulerSection.hint(config)
    expect(hint).toContain('09:00')
  })

  it('sets a new schedule', async () => {
    const {schedulerSection} = await import('./scheduler')
    mockScheduleResult = '0 9 * * 1'

    promptResponses = {
      [M.action]: 'set',
    }

    const result = await schedulerSection.edit(baseConfig, '/fake')
    expect(result.sync?.schedule).toBe('0 9 * * 1')
  })

  it('clears existing schedule', async () => {
    const {schedulerSection} = await import('./scheduler')
    const config: ProjectConfig = {...baseConfig, sync: {schedule: '0 9 * * 1'}}

    promptResponses = {
      [M.action]: 'clear',
    }

    const result = await schedulerSection.edit(config, '/fake')
    expect(result.sync?.schedule).toBeUndefined()

    const successCalls = rendererCalls.filter((c) => c.method === 'renderSuccess')
    expect(successCalls.some((c) => (c.args[0] as string).includes('cleared'))).toBe(true)
  })

  it('preserves config when done is selected', async () => {
    const {schedulerSection} = await import('./scheduler')
    const config: ProjectConfig = {...baseConfig, sync: {schedule: '0 9 * * 1'}}

    promptResponses = {
      [M.action]: 'done',
    }

    const result = await schedulerSection.edit(config, '/fake')
    expect(result.sync?.schedule).toBe('0 9 * * 1')
  })

  it('preserves other config fields', async () => {
    const {schedulerSection} = await import('./scheduler')
    const config: ProjectConfig = {
      ...baseConfig,
      assistants: [{id: 'cursor', enabled: true}],
      sources: [{name: 'team', type: 'git'}],
    }

    promptResponses = {[M.action]: 'done'}

    const result = await schedulerSection.edit(config, '/fake')
    expect(result.assistants).toEqual(config.assistants)
    expect(result.sources).toEqual(config.sources)
  })
})
