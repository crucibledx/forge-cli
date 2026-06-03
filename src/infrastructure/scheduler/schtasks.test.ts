import {describe, expect, it} from 'bun:test'

import {cronToSchtasksArgs} from './schtasks'

describe('schtasks', () => {
  describe('cronToSchtasksArgs', () => {
    it('maps minute interval: */5 * * * *', () => {
      expect(cronToSchtasksArgs('*/5 * * * *')).toEqual(['/sc', 'MINUTE', '/mo', '5'])
    })

    it('maps hourly interval: 0 */2 * * *', () => {
      expect(cronToSchtasksArgs('0 */2 * * *')).toEqual(['/sc', 'HOURLY', '/mo', '2'])
    })

    it('maps daily at specific time: 0 9 * * *', () => {
      expect(cronToSchtasksArgs('0 9 * * *')).toEqual(['/sc', 'DAILY', '/st', '09:00'])
    })

    it('pads single-digit hour and minute: 5 8 * * *', () => {
      expect(cronToSchtasksArgs('5 8 * * *')).toEqual(['/sc', 'DAILY', '/st', '08:05'])
    })

    it('maps weekly on single day: 0 9 * * 1', () => {
      expect(cronToSchtasksArgs('0 9 * * 1')).toEqual(['/sc', 'WEEKLY', '/d', 'MON', '/st', '09:00'])
    })

    it('maps weekly on multiple days: 30 8 * * 1,3,5', () => {
      expect(cronToSchtasksArgs('30 8 * * 1,3,5')).toEqual(['/sc', 'WEEKLY', '/d', 'MON,WED,FRI', '/st', '08:30'])
    })

    it('maps weekday 0 to SUN', () => {
      expect(cronToSchtasksArgs('0 10 * * 0')).toEqual(['/sc', 'WEEKLY', '/d', 'SUN', '/st', '10:00'])
    })

    it('maps weekday 7 to SUN', () => {
      expect(cronToSchtasksArgs('0 10 * * 7')).toEqual(['/sc', 'WEEKLY', '/d', 'SUN', '/st', '10:00'])
    })

    it('throws for complex cron with day-of-month', () => {
      expect(() => cronToSchtasksArgs('0 9 15 * *')).toThrow('cannot be mapped to Windows Task Scheduler')
    })

    it('throws for complex cron with month', () => {
      expect(() => cronToSchtasksArgs('0 9 * 6 *')).toThrow('cannot be mapped to Windows Task Scheduler')
    })

    it('throws for wildcard minute with specific hour', () => {
      expect(() => cronToSchtasksArgs('* 9 * * *')).toThrow('cannot be mapped to Windows Task Scheduler')
    })
  })
})
