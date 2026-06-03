import {describe, expect, it} from 'bun:test'

import {buildPlist, cronToPlistCalendar, cronToStartInterval, plistPathFor} from './launchd'

describe('launchd', () => {
  describe('plistPathFor', () => {
    it('returns path under ~/Library/LaunchAgents', () => {
      const path = plistPathFor('crucible-forge-sync-my-project')
      expect(path).toContain('Library/LaunchAgents/crucible-forge-sync-my-project.plist')
    })
  })

  describe('cronToStartInterval', () => {
    it('returns seconds for minute interval: */5 * * * *', () => {
      expect(cronToStartInterval('*/5 * * * *')).toBe(300)
    })

    it('returns seconds for hourly interval: 0 */2 * * *', () => {
      expect(cronToStartInterval('0 */2 * * *')).toBe(7200)
    })

    it('returns null for fixed time patterns', () => {
      expect(cronToStartInterval('0 9 * * 1')).toBeNull()
    })

    it('returns null for all wildcards', () => {
      expect(cronToStartInterval('* * * * *')).toBeNull()
    })
  })

  describe('cronToPlistCalendar', () => {
    it('maps all non-wildcard fields', () => {
      const result = cronToPlistCalendar('30 9 15 6 3')
      expect(result).toContain('<key>Minute</key>')
      expect(result).toContain('<integer>30</integer>')
      expect(result).toContain('<key>Hour</key>')
      expect(result).toContain('<integer>9</integer>')
      expect(result).toContain('<key>Day</key>')
      expect(result).toContain('<integer>15</integer>')
      expect(result).toContain('<key>Month</key>')
      expect(result).toContain('<integer>6</integer>')
      expect(result).toContain('<key>Weekday</key>')
      expect(result).toContain('<integer>3</integer>')
    })

    it('skips wildcard fields', () => {
      const result = cronToPlistCalendar('0 9 * * 1')
      expect(result).toContain('<key>Minute</key>')
      expect(result).toContain('<key>Hour</key>')
      expect(result).toContain('<key>Weekday</key>')
      expect(result).not.toContain('<key>Day</key>')
      expect(result).not.toContain('<key>Month</key>')
    })

    it('returns empty for all wildcards', () => {
      const result = cronToPlistCalendar('* * * * *')
      expect(result).toBe('')
    })

    it('throws for step values that reach calendar path', () => {
      expect(() => cronToPlistCalendar('0 */3 * * 1')).toThrow('step values')
    })
  })

  describe('buildPlist', () => {
    it('generates valid plist XML with StartCalendarInterval for fixed times', () => {
      const plist = buildPlist('test-title', '/my/project', '/usr/local/bin/forge sync --silent', '0 9 * * 1')
      expect(plist).toContain('<?xml version="1.0"')
      expect(plist).toContain('<string>test-title</string>')
      expect(plist).toContain('<string>/usr/local/bin/forge</string>')
      expect(plist).toContain('<string>sync</string>')
      expect(plist).toContain('<string>--silent</string>')
      expect(plist).toContain('<key>StartCalendarInterval</key>')
      expect(plist).toContain('<key>Minute</key>')
      expect(plist).toContain('<integer>0</integer>')
    })

    it('uses StartInterval for minute intervals', () => {
      const plist = buildPlist('test-title', '/my/project', '/usr/local/bin/forge sync --silent', '*/5 * * * *')
      expect(plist).toContain('<key>StartInterval</key>')
      expect(plist).toContain('<integer>300</integer>')
      expect(plist).not.toContain('StartCalendarInterval')
    })

    it('uses StartInterval for hourly intervals', () => {
      const plist = buildPlist('test-title', '/my/project', '/usr/local/bin/forge sync --silent', '0 */2 * * *')
      expect(plist).toContain('<key>StartInterval</key>')
      expect(plist).toContain('<integer>7200</integer>')
    })

    it('splits multi-word command into separate args', () => {
      const plist = buildPlist(
        'test-title',
        '/my/project',
        '/usr/local/bin/bun /src/main.ts sync --silent',
        '0 9 * * 1',
      )
      expect(plist).toContain('<string>/usr/local/bin/bun</string>')
      expect(plist).toContain('<string>/src/main.ts</string>')
      expect(plist).toContain('<string>sync</string>')
      expect(plist).toContain('<string>--silent</string>')
    })
  })
})
