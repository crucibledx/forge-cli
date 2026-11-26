/**
 * Unit tests for the harnesses config section editor.
 */

import {beforeEach, describe, expect, it, mock} from 'bun:test'

import type {ProjectConfig} from '@domain/config/types'
import {cursor} from '@domain/harnesses/cursor'
import {windsurf} from '@domain/harnesses/windsurf'

import {HARNESSES_MESSAGES as M} from './harnesses'

// ─── Mock state ──────────────────────────────────────────────────────────────

let mockDetectionResults: Array<{id: string; name: string; detected: boolean; scope?: 'project' | 'global'}> = []
let promptResponses: Record<string, unknown> = {}

// ─── Mocks ───────────────────────────────────────────────────────────────────

mock.module('@domain/harnesses/registry', () => ({
  getAllHarnesses: () => [
    {...cursor, detection: {directories: [], files: []}, targetMappings: []},
    {...windsurf, detection: {directories: [], files: []}, targetMappings: []},
  ],
}))

mock.module('@infrastructure/fs', () => ({
  scanForHarnesses: () => mockDetectionResults,
}))

mock.module('@infrastructure/cli/renderer', () => ({
  renderNewline: () => {},
  renderWarning: () => {},
  renderSuccess: () => {},
}))

mock.module('@infrastructure/cli/prompts', () => ({
  spinner: () => ({start: () => {}, stop: () => {}}),
  multiselect: async (opts: {message: string}) => promptResponses[opts.message] ?? [],
}))

// ─── Reset ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockDetectionResults = []
  promptResponses = {}
})

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('harnessesSection', () => {
  const baseConfig: ProjectConfig = {version: '1', harnesses: [], sources: []}

  it('hint returns count of enabled harnesses', async () => {
    const {harnessesSection} = await import('./harnesses')
    expect(harnessesSection.hint(baseConfig)).toBe('none enabled')
    expect(
      harnessesSection.hint({
        ...baseConfig,
        harnesses: [
          {id: 'cursor', enabled: true},
          {id: 'windsurf', enabled: true},
        ],
      }),
    ).toBe('2 enabled')
  })

  it('returns config with selected harnesses', async () => {
    promptResponses = {[M.select]: [cursor.id, windsurf.id]}
    const {harnessesSection} = await import('./harnesses')
    const result = await harnessesSection.edit(baseConfig, '/fake')
    expect(result.harnesses).toHaveLength(2)
    expect(result.harnesses[0].id).toBe(cursor.id)
    expect(result.harnesses[1].id).toBe(windsurf.id)
    expect(result.harnesses.every((a) => a.enabled)).toBe(true)
  })

  it('returns empty harnesses when none selected', async () => {
    promptResponses = {[M.select]: []}
    const {harnessesSection} = await import('./harnesses')
    const result = await harnessesSection.edit(baseConfig, '/fake')
    expect(result.harnesses).toHaveLength(0)
  })

  it('preserves other config fields', async () => {
    const config: ProjectConfig = {
      ...baseConfig,
      sources: [{name: 'default', type: 'local', path: '/tmp'}],
    }
    promptResponses = {[M.select]: [cursor.id]}
    const {harnessesSection} = await import('./harnesses')
    const result = await harnessesSection.edit(config, '/fake')
    expect(result.sources).toEqual(config.sources)
  })
})
