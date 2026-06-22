import {beforeEach, describe, expect, it} from 'bun:test'

import {getTelemetryContext, resetTelemetryContext, setTelemetryContext} from './context'

describe('telemetry context', () => {
  beforeEach(() => {
    resetTelemetryContext()
  })

  it('starts empty', () => {
    expect(getTelemetryContext()).toEqual({})
  })

  it('sets and gets values', () => {
    setTelemetryContext({startedAt: 1000})
    expect(getTelemetryContext().startedAt).toBe(1000)
  })

  it('merges partial updates', () => {
    setTelemetryContext({startedAt: 1000})
    setTelemetryContext({file_count: 5})
    const ctx = getTelemetryContext()
    expect(ctx.startedAt).toBe(1000)
    expect(ctx.file_count).toBe(5)
  })

  it('tracks success field', () => {
    setTelemetryContext({success: false})
    expect(getTelemetryContext().success).toBe(false)
  })

  it('defaults success to undefined', () => {
    expect(getTelemetryContext().success).toBeUndefined()
  })

  it('resets to empty', () => {
    setTelemetryContext({startedAt: 1000, file_count: 5, success: false})
    resetTelemetryContext()
    expect(getTelemetryContext()).toEqual({})
  })
})
