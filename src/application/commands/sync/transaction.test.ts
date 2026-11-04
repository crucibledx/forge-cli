import {readFile} from 'node:fs/promises'
import {join} from 'node:path'

import {snapshot} from '@test-helpers/snapshot'
import {syncFixture, trackedPath} from '@test-helpers/sync-fixture'
import {useTmpDir} from '@test-helpers/tmp'
import {describe, expect, it, spyOn} from 'bun:test'

import {buildSyncState} from '@domain/sync/state'
import {TransactionError, transactionIO} from '@infrastructure/fs/transaction'

import {executePlan} from './handler'

describe('BR-06 state/config commit and recovery (AC-7,11,23)', () => {
  const dir = useTmpDir('application-transaction')
  const next = () => buildSyncState([{targetPath: trackedPath, content: 'after', sourceName: 'team'}])
  it('restores exact legacy metadata and target bytes after a partially committed config fails', async () => {
    const {context, legacy} = await syncFixture(dir())
    const before = await snapshot(dir())
    let failed = false
    const fs = {
      ...transactionIO,
      replace: async (...args: Parameters<typeof transactionIO.replace>) => {
        await transactionIO.replace(...args)
        if (!failed && args[1].endsWith('forge.config.yaml')) {
          failed = true
          throw new Error('partial config commit failed')
        }
      },
    }
    await expect(
      executePlan(dir(), [{type: 'file_write', path: trackedPath, content: 'after'}], next(), context, fs),
    ).rejects.toThrow('Rollback complete')
    expect(await snapshot(dir())).toEqual(before)
    expect(await readFile(join(dir(), '.crucible/sync-state.json'), 'utf8')).toBe(legacy)
  })
  it('names untrusted state and retains backups plus private recovery bytes when state restoration fails', async () => {
    const {context} = await syncFixture(dir())
    let restoring = false
    const fs = {
      ...transactionIO,
      replace: async (...args: Parameters<typeof transactionIO.replace>) => {
        if (args[1].endsWith('forge.config.yaml') && !restoring) {
          restoring = true
          throw new Error('config commit failed')
        }
        if (args[1].endsWith('sync-state.json') && restoring) throw new Error('state restoration failed')
        await transactionIO.replace(...args)
      },
    }
    const emergency = spyOn(console, 'error').mockImplementation(() => {})
    try {
      await expect(
        executePlan(
          dir(),
          [
            {type: 'file_write', path: `${trackedPath}.bak`, content: 'before'},
            {type: 'file_write', path: trackedPath, content: 'after'},
          ],
          next(),
          context,
          fs,
        ),
      ).rejects.toBeInstanceOf(TransactionError)
      const message = emergency.mock.calls.flat().join(' ')
      expect(message).toContain('Recovery required')
      expect(message).toContain('.crucible/sync-state.json')
      expect(message).toContain('untrusted')
      expect(message).not.toContain('Rollback complete')
      expect(await readFile(join(dir(), `${trackedPath}.bak`), 'utf8')).toBe('before')
      expect(await readFile(join(dir(), trackedPath), 'utf8')).toBe('before')
      const recovery = Object.keys(await snapshot(dir())).filter((path) => path.endsWith('.tmp'))
      expect(recovery.length).toBeGreaterThan(0)
      expect(JSON.parse(await readFile(join(dir(), recovery[0]), 'utf8'))).not.toHaveProperty('version')
    } finally {
      emergency.mockRestore()
    }
  })
})
