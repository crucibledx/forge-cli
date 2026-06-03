import {describe, expect, it} from 'bun:test'

import {describeCron, isValidCron} from './cron'

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
