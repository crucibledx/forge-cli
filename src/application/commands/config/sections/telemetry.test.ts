import {beforeEach, describe, expect, it, mock} from 'bun:test'

import type {ProjectConfig} from '@domain/config/types'

import {TELEMETRY_SECTION_MESSAGES as TM} from './telemetry'

// ─── Mock state ──────────────────────────────────────────────────────────────

let confirmResponse = false

// ─── Mocks ───────────────────────────────────────────────────────────────────

mock.module('@infrastructure/cli/prompts', () => ({
  confirm: async () => confirmResponse,
}))

// ─── Reset ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  confirmResponse = false
})

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('telemetrySection', () => {
  const baseConfig: ProjectConfig = {version: '1', assistants: [], sources: []}

  it('hint returns "disabled" when no telemetry config', async () => {
    const {telemetrySection} = await import('./telemetry')
    expect(telemetrySection.hint(baseConfig)).toBe(TM.hintDisabled)
  })

  it('hint returns "enabled" when telemetry is enabled', async () => {
    const {telemetrySection} = await import('./telemetry')
    expect(telemetrySection.hint({...baseConfig, telemetry: {enabled: true}})).toBe(TM.hintEnabled)
  })

  it('hint returns "disabled" when telemetry is explicitly disabled', async () => {
    const {telemetrySection} = await import('./telemetry')
    expect(telemetrySection.hint({...baseConfig, telemetry: {enabled: false}})).toBe(TM.hintDisabled)
  })

  it('edits telemetry enabled state', async () => {
    const {telemetrySection} = await import('./telemetry')
    confirmResponse = true
    const result = await telemetrySection.edit(baseConfig, '/tmp')
    expect(result.telemetry?.enabled).toBe(true)
  })

  it('preserves other config fields', async () => {
    const {telemetrySection} = await import('./telemetry')
    confirmResponse = true
    const config = {...baseConfig, project: {name: 'test'}}
    const result = await telemetrySection.edit(config, '/tmp')
    expect(result.project?.name).toBe('test')
    expect(result.telemetry?.enabled).toBe(true)
  })
})
