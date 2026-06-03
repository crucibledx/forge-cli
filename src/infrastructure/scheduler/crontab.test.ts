import {describe, expect, it} from 'bun:test'

import {buildCrontabEntry, crontabMarker, removeCrontabEntry} from './crontab'

describe('crontab', () => {
  describe('crontabMarker', () => {
    it('returns comment with title', () => {
      expect(crontabMarker('crucible-forge-sync-my-project')).toBe('# crucible-forge-sync-my-project')
    })
  })

  describe('buildCrontabEntry', () => {
    it('generates marker + quoted entry lines', () => {
      const entry = buildCrontabEntry(
        'crucible-forge-sync-my-project',
        '/my/project',
        '0 9 * * 1',
        '/usr/local/bin/forge sync --silent',
      )
      expect(entry).toBe(
        '# crucible-forge-sync-my-project\n0 9 * * 1 cd "/my/project" && /usr/local/bin/forge sync --silent',
      )
    })

    it('quotes paths with spaces in projectRoot', () => {
      const entry = buildCrontabEntry('test', '/Users/John Smith/project', '0 9 * * *', 'forge sync --silent')
      expect(entry).toContain('cd "/Users/John Smith/project"')
      expect(entry).toContain('forge sync --silent')
    })
  })

  describe('removeCrontabEntry', () => {
    it('removes marker and the line after it', () => {
      const content = '# other\nother-entry\n# crucible-forge-sync-test\n0 9 * * 1 cd /x && forge sync --silent\n'
      const result = removeCrontabEntry(content, '# crucible-forge-sync-test')
      expect(result).not.toContain('crucible-forge-sync-test')
      expect(result).not.toContain('forge sync --silent')
      expect(result).toContain('# other')
      expect(result).toContain('other-entry')
    })

    it('returns unchanged content when marker is absent', () => {
      const content = '# other\nother-entry\n'
      expect(removeCrontabEntry(content, '# crucible-forge-sync-test')).toBe(content)
    })
  })
})
