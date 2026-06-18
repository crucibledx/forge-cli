import {beforeEach, describe, expect, it, mock} from 'bun:test'

import type {ProjectConfig} from '@domain/config/types'
import {LOCAL_CONFLICT_STRATEGIES, SOURCE_CONFLICT_STRATEGIES} from '@domain/config/types'

import {SYNC_SECTION_MESSAGES as SM} from './sync'

// ─── Mock state ──────────────────────────────────────────────────────────────

let promptResponses: Record<string, unknown> = {}

// ─── Mocks ───────────────────────────────────────────────────────────────────

mock.module('@infrastructure/cli/renderer', () => ({
  renderNewline: () => {},
  renderWarning: () => {},
  renderSuccess: () => {},
  renderDim: () => {},
}))

mock.module('@infrastructure/cli/prompts', () => ({
  select: async (opts: {message: string}) => {
    const val = promptResponses[opts.message]
    if (Array.isArray(val)) return val.shift() ?? ''
    return val ?? ''
  },
  confirm: async (opts: {message: string}) => {
    const val = promptResponses[opts.message]
    return (val as boolean) ?? false
  },
}))

// ─── Reset ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  promptResponses = {}
})

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('syncSection', () => {
  const baseConfig: ProjectConfig = {version: '1', assistants: [], sources: []}

  it('hint returns "using defaults" when no sync config', async () => {
    const {syncSection} = await import('./sync')
    expect(syncSection.hint(baseConfig)).toBe(SM.hintDefault)
  })

  it('hint returns "using defaults" when sync config matches defaults', async () => {
    const {syncSection} = await import('./sync')
    const config: ProjectConfig = {
      ...baseConfig,
      sync: {
        source_conflict_strategy: 'last-wins',
        local_conflict_strategy: 'remote-wins',
        backup: true,
        keep_local: true,
      },
    }
    expect(syncSection.hint(config)).toBe(SM.hintDefault)
  })

  it('hint shows non-default source_conflict_strategy', async () => {
    const {syncSection} = await import('./sync')
    const config: ProjectConfig = {...baseConfig, sync: {source_conflict_strategy: 'first-wins'}}
    expect(syncSection.hint(config)).toContain('source: first-wins')
  })

  it('hint shows non-default local_conflict_strategy', async () => {
    const {syncSection} = await import('./sync')
    const config: ProjectConfig = {...baseConfig, sync: {local_conflict_strategy: 'error'}}
    expect(syncSection.hint(config)).toContain('local: error')
  })

  it('hint shows backup off', async () => {
    const {syncSection} = await import('./sync')
    const config: ProjectConfig = {...baseConfig, sync: {backup: false}}
    expect(syncSection.hint(config)).toContain('backup: off')
  })

  it('hint shows keep-local off', async () => {
    const {syncSection} = await import('./sync')
    const config: ProjectConfig = {...baseConfig, sync: {keep_local: false}}
    expect(syncSection.hint(config)).toContain('keep-local: off')
  })

  it('edits sync settings', async () => {
    const {syncSection, SYNC_PROMPT_MESSAGES: SP} = await import('./sync')

    promptResponses = {
      [SP.sourceConflict.message]: SOURCE_CONFLICT_STRATEGIES.FIRST_WINS,
      [SP.localConflict.message]: LOCAL_CONFLICT_STRATEGIES.LOCAL_WINS,
      [SP.backup]: false,
      [SP.keepLocal]: false,
    }

    const result = await syncSection.edit(baseConfig, '/fake')
    expect(result.sync?.source_conflict_strategy).toBe('first-wins')
    expect(result.sync?.local_conflict_strategy).toBe('local-wins')
    expect(result.sync?.backup).toBe(false)
    expect(result.sync?.keep_local).toBe(false)
  })

  it('preserves schedule when editing sync settings', async () => {
    const {syncSection, SYNC_PROMPT_MESSAGES: SP} = await import('./sync')
    const config: ProjectConfig = {...baseConfig, sync: {schedule: '0 9 * * 1'}}

    promptResponses = {
      [SP.sourceConflict.message]: SOURCE_CONFLICT_STRATEGIES.LAST_WINS,
      [SP.localConflict.message]: LOCAL_CONFLICT_STRATEGIES.REMOTE_WINS,
      [SP.backup]: true,
      [SP.keepLocal]: true,
    }

    const result = await syncSection.edit(config, '/fake')
    expect(result.sync?.schedule).toBe('0 9 * * 1')
  })

  it('preserves other config fields', async () => {
    const {syncSection, SYNC_PROMPT_MESSAGES: SP} = await import('./sync')
    const config: ProjectConfig = {
      ...baseConfig,
      assistants: [{id: 'cursor', enabled: true}],
      sources: [{name: 'team', type: 'git'}],
    }

    promptResponses = {
      [SP.sourceConflict.message]: SOURCE_CONFLICT_STRATEGIES.LAST_WINS,
      [SP.localConflict.message]: LOCAL_CONFLICT_STRATEGIES.REMOTE_WINS,
      [SP.backup]: true,
      [SP.keepLocal]: true,
    }

    const result = await syncSection.edit(config, '/fake')
    expect(result.assistants).toEqual(config.assistants)
    expect(result.sources).toEqual(config.sources)
  })
})
