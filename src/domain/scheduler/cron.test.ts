import {describe, expect, it} from 'bun:test'

import {describeCron, isValidCron, nextCronRun} from './cron'

describe('isValidCron', () => {
  it('accepts standard 5-field cron', () => {
    expect(isValidCron('0 9 * * 1')).toBe(true)
    expect(isValidCron('*/5 * * * *')).toBe(true)
    expect(isValidCron('30 14 1 * *')).toBe(true)
  })

  it('rejects invalid cron', () => {
    expect(isValidCron('')).toBe(false)
    expect(isValidCron('every monday')).toBe(false)
    expect(isValidCron('* * * *')).toBe(false)
  })
})

describe('describeCron', () => {
  it('describes daily schedule', () => {
    const result = describeCron('0 9 * * *')
    expect(result.toLowerCase()).toContain('09:00')
  })

  it('describes weekly schedule', () => {
    const result = describeCron('0 9 * * 1')
    expect(result.toLowerCase()).toContain('monday')
  })

  it('describes interval schedule', () => {
    const result = describeCron('*/5 * * * *')
    expect(result.toLowerCase()).toContain('5')
  })

  it('falls back to raw expression for invalid input', () => {
    expect(describeCron('not a cron')).toBe('not a cron')
  })
})

describe('nextCronRun', () => {
  it('returns next occurrence for weekly schedule', () => {
    const from = new Date('2026-06-01T10:00:00Z') // Sunday
    const next = nextCronRun('0 9 * * 1', from) // Every Monday at 9am
    expect(next).not.toBeNull()
    expect(next!.getDay()).toBe(1) // Monday
  })

  it('returns next occurrence for daily schedule', () => {
    const from = new Date('2026-06-01T08:00:00Z')
    const next = nextCronRun('0 9 * * *', from)
    expect(next).not.toBeNull()
    expect(next!.getHours()).toBe(9)
  })

  it('returns next occurrence for interval schedule', () => {
    const from = new Date('2026-06-01T08:00:00Z')
    const next = nextCronRun('*/5 * * * *', from)
    expect(next).not.toBeNull()
    expect(next!.getTime()).toBeGreaterThan(from.getTime())
  })

  it('returns null for invalid expression', () => {
    expect(nextCronRun('not a cron')).toBeNull()
  })
})
