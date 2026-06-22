import {describe, expect, it} from 'bun:test'

import type {ProjectConfig} from '@domain/config/types'

import type {TelemetryBackend} from './backend'
import {TELEMETRY_BACKEND_TYPES} from './backend'
import {buildTelemetryService, getBackend, resolveTelemetryConfig} from './service'
import type {TelemetryEvent} from './types'
import {TELEMETRY_EVENTS} from './types'

// ─── Config resolution ──────────────────────────────────────────────────────

const minConfig = (telemetry?: Partial<{enabled: boolean; backend: string}>): ProjectConfig => ({
  version: '1',
  assistants: [],
  sources: [],
  ...(telemetry ? {telemetry} : {}),
})

describe('resolveTelemetryConfig', () => {
  it('returns defaults when no config', () => {
    const config = resolveTelemetryConfig(null, null)
    expect(config.enabled).toBe(false)
    expect(config.backend).toBe('local')
  })

  it('returns global setting when project has no override', () => {
    expect(resolveTelemetryConfig(minConfig({enabled: true}), null).enabled).toBe(true)
    expect(resolveTelemetryConfig(minConfig({enabled: false}), null).enabled).toBe(false)
  })

  it('returns project override when set', () => {
    expect(resolveTelemetryConfig(minConfig({enabled: true}), minConfig({enabled: false})).enabled).toBe(false)
    expect(resolveTelemetryConfig(minConfig({enabled: false}), minConfig({enabled: true})).enabled).toBe(true)
  })

  it('inherits global when project telemetry is undefined', () => {
    expect(resolveTelemetryConfig(minConfig({enabled: true}), minConfig()).enabled).toBe(true)
  })

  it('defaults to false when both configs exist but neither sets telemetry', () => {
    expect(resolveTelemetryConfig(minConfig(), minConfig()).enabled).toBe(false)
  })

  it('uses project backend override', () => {
    const config = resolveTelemetryConfig(minConfig({backend: 'local'}), minConfig({backend: 'custom'}))
    expect(config.backend).toBe('custom')
  })

  it('falls back to global backend when project has none', () => {
    const config = resolveTelemetryConfig(minConfig({backend: 'local'}), minConfig())
    expect(config.backend).toBe('local')
  })
})

describe('getBackend', () => {
  it('returns local backend by default', () => {
    const backend = getBackend()
    expect(backend.storageDir).toBeDefined()
  })

  it('returns local backend for explicit local type', () => {
    const backend = getBackend(TELEMETRY_BACKEND_TYPES.LOCAL)
    expect(backend.storageDir).toBeDefined()
  })

  it('falls back to local for unknown type', () => {
    const backend = getBackend('unknown-type' as never)
    expect(backend.storageDir).toBeDefined()
  })
})

// ─── Service ────────────────────────────────────────────────────────────────

function createMockBackend(): TelemetryBackend & {events: TelemetryEvent[]} {
  const events: TelemetryEvent[] = []
  return {
    events,
    storageDir: '/tmp/telemetry',
    async write(event) {
      events.push(event)
    },
    async readAll() {
      return events
    },
    async count() {
      return events.length
    },
    async clear() {
      events.length = 0
    },
  }
}

describe('buildTelemetryService', () => {
  it('tracks events when enabled', async () => {
    const backend = createMockBackend()
    const service = buildTelemetryService(true, backend)

    await service.track({
      event: TELEMETRY_EVENTS.SYNC,
      duration_ms: 100,
      success: true,
      file_count: 5,
    })

    expect(backend.events).toHaveLength(1)
    expect(backend.events[0].event).toBe('sync')
    expect(backend.events[0].duration_ms).toBe(100)
    expect(backend.events[0].file_count).toBe(5)
    expect(backend.events[0].forge_version).toBeDefined()
    expect(backend.events[0].os).toBeDefined()
    expect(backend.events[0].ts).toBeDefined()
  })

  it('does not track when disabled', async () => {
    const backend = createMockBackend()
    const service = buildTelemetryService(false, backend)

    await service.track({
      event: TELEMETRY_EVENTS.INIT,
      duration_ms: 0,
      success: true,
    })

    expect(backend.events).toHaveLength(0)
  })

  it('reads events from backend', async () => {
    const backend = createMockBackend()
    const service = buildTelemetryService(true, backend)

    await service.track({
      event: TELEMETRY_EVENTS.HEALTH,
      duration_ms: 50,
      success: true,
    })

    const events = await service.readEvents()
    expect(events).toHaveLength(1)
    expect(events[0].event).toBe('health')
  })

  it('reports event count', async () => {
    const backend = createMockBackend()
    const service = buildTelemetryService(true, backend)

    await service.track({
      event: TELEMETRY_EVENTS.SYNC,
      duration_ms: 0,
      success: true,
    })
    await service.track({
      event: TELEMETRY_EVENTS.STATUS,
      duration_ms: 0,
      success: true,
    })

    expect(await service.eventCount()).toBe(2)
  })

  it('clears all events', async () => {
    const backend = createMockBackend()
    const service = buildTelemetryService(true, backend)

    await service.track({event: TELEMETRY_EVENTS.SYNC, duration_ms: 0, success: true})
    await service.track({event: TELEMETRY_EVENTS.HEALTH, duration_ms: 0, success: true})
    expect(await service.eventCount()).toBe(2)

    await service.clear()
    expect(await service.eventCount()).toBe(0)
  })

  it('returns storage dir from backend', () => {
    const backend = createMockBackend()
    const service = buildTelemetryService(true, backend)
    expect(service.getStorageDir()).toBe('/tmp/telemetry')
  })
})
