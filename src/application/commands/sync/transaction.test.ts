import {chmod, readFile, stat, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {snapshot} from '@test-helpers/snapshot'
import {applySyncPlan as executePlan, syncFixture, trackedPath} from '@test-helpers/sync-fixture'
import {buildSyncState} from '@test-helpers/sync-state'
import {useTmpDir} from '@test-helpers/tmp'
import {describe, expect, it, spyOn} from 'bun:test'

import {SYNC_CONFIG_DEFAULTS} from '@domain/config/types'
import {hashContent} from '@domain/sync/state'
import {TransactionError, transactionIO} from '@infrastructure/fs/transaction'

import {buildPlan} from './handler'

describe('BR-06 state/config commit and recovery (AC-7,11,23)', () => {
  const dir = useTmpDir('application-transaction')
  const next = () => buildSyncState([{targetPath: trackedPath, content: 'after', sourceName: 'team'}])
  it.each(['update', 'stale'])(
    'AC-10 private %s backups never expose original0600 bytes under umask022',
    async (kind) => {
      if (process.platform === 'win32') return
      const {context} = await syncFixture(dir()),
        previousMask = process.umask(0o022)
      try {
        await chmod(join(dir(), '.claude/rules'), 0o755)
        await chmod(join(dir(), trackedPath), 0o600)
        const targets =
          kind === 'update'
            ? [
                {
                  targetPath: trackedPath,
                  sourcePath: 'rules/a.md',
                  sourceName: 'team',
                  assistantId: 'claude-code',
                  content: 'after',
                },
              ]
            : []
        const state = {lastSync: '', files: {[trackedPath]: {hash: hashContent('before'), sourceName: 'team'}}}
        const plan = await buildPlan(dir(), targets, state, {...SYNC_CONFIG_DEFAULTS, keep_local: false})
        await executePlan(dir(), plan.mutations, buildSyncState(targets), context)
        expect(await readFile(join(dir(), `${trackedPath}.bak`), 'utf8')).toBe('before')
        expect((await stat(join(dir(), `${trackedPath}.bak`))).mode & 0o777).toBe(0o600)
      } finally {
        process.umask(previousMask)
      }
    },
  )
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
  it('AC-11 names untrusted state and retains backups plus private recovery bytes when state restoration fails', async () => {
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
            {type: 'file_write', path: `${trackedPath}.bak`, content: 'before', backup: true},
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
      if (process.platform !== 'win32') expect((await stat(join(dir(), `${trackedPath}.bak`))).mode & 0o077).toBe(0)
      expect(await readFile(join(dir(), trackedPath), 'utf8')).toBe('before')
      const recovery = Object.keys(await snapshot(dir())).filter((path) => path.endsWith('.tmp'))
      expect(recovery.length).toBeGreaterThan(0)
      expect(JSON.parse(await readFile(join(dir(), recovery[0]), 'utf8'))).not.toHaveProperty('version')
    } finally {
      emergency.mockRestore()
    }
  })
  it('never reapplies incoming source .bak bytes as recovery data after a double failure', async () => {
    const {context} = await syncFixture(dir())
    const path = '.claude/rules/source.bak'
    await writeFile(join(dir(), path), 'original source target')
    const target = {
      targetPath: path,
      sourcePath: 'rules/source.bak',
      content: 'incoming source target',
      assistantId: 'claude-code',
      sourceName: 'team',
    }
    const plan = await buildPlan(dir(), [target], {lastSync: '', files: {}}, {...SYNC_CONFIG_DEFAULTS, backup: false})
    expect(plan.mutations).toEqual([{type: 'file_write', path, content: target.content}])
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
      await expect(executePlan(dir(), plan.mutations, buildSyncState([target]), context, fs)).rejects.toThrow(
        'unrestored/untrusted: .crucible/sync-state.json',
      )
      expect(await readFile(join(dir(), path), 'utf8')).toBe('original source target')
      expect(emergency.mock.calls.flat().join(' ')).not.toContain('incoming source target')
    } finally {
      emergency.mockRestore()
    }
  })
})
