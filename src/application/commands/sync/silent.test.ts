import {readFile} from 'node:fs/promises'
import {join} from 'node:path'

import {handlerFixture, trackedPath} from '@test-helpers/sync-fixture'
import {useTmpDir} from '@test-helpers/tmp'
import {afterEach, expect, it, spyOn} from 'bun:test'

import {transactionIO} from '@infrastructure/fs/transaction'

import {runSyncWithDependencies} from './handler'
const dir = useTmpDir('injected-silent')
afterEach(() => {
  process.exitCode = 0
})
it('AC-23 silent incomplete recovery names the unrestored state even when report storage also fails', async () => {
  const root = dir(),
    {dependencies} = await handlerFixture(root)
  dependencies.reports.writeReport = async () => {
    throw new Error('report storage denied')
  }
  let restoring = false
  const transaction = {
    ...transactionIO,
    replace: async (...args: Parameters<typeof transactionIO.replace>) => {
      if (args[1].endsWith('forge.config.yaml') && !restoring) {
        restoring = true
        throw new Error('config failed ftps://user:credential-sentinel@fixture.invalid/repo')
      }
      if (args[1].endsWith('sync-state.json') && restoring) throw new Error('state restoration failed')
      await transactionIO.replace(...args)
    },
  }
  const stdout = spyOn(console, 'log').mockImplementation(() => {})
  const stderr = spyOn(console, 'error').mockImplementation(() => {})
  try {
    await runSyncWithDependencies({dryRun: false, silent: true, verbose: false}, {...dependencies, transaction})
    expect(process.exitCode).toBe(1)
    expect(stdout).not.toHaveBeenCalled()
    const message = stderr.mock.calls.flat().join(' ')
    expect(message).toContain('Recovery required')
    expect(message).toContain('.crucible/sync-state.json')
    expect(message).toContain('untrusted')
    expect(message).not.toContain('credential-sentinel')
    expect(await readFile(join(root, trackedPath), 'utf8')).toBe('before')
    expect(await readFile(join(root, `${trackedPath}.bak`), 'utf8')).toBe('before')
  } finally {
    stdout.mockRestore()
    stderr.mockRestore()
  }
})
