import {readFile} from 'node:fs/promises'
import {join} from 'node:path'

import {handlerFixture, protectedBytes, trackedPath} from '@test-helpers/sync-fixture'
import {useTmpDir} from '@test-helpers/tmp'
import {afterEach, expect, it, spyOn} from 'bun:test'

import {transactionIO} from '@infrastructure/fs/transaction'

import {runSyncWithDependencies} from './handler'
const dir = useTmpDir('injected-state')
const options = {dryRun: false, verbose: false, silent: true}
afterEach(() => {
  process.exitCode = 0
})
it('AC-7 acquisition failure preserves both original timestamps and every protected byte', async () => {
  const root = dir(),
    {dependencies} = await handlerFixture(root)
  const before = await protectedBytes(root)
  dependencies.loadSource = async () => {
    throw new Error('acquisition failed')
  }
  await runSyncWithDependencies(options, dependencies)
  expect(process.exitCode).toBe(1)
  expect(await protectedBytes(root)).toEqual(before)
})
it.each([trackedPath, '.crucible/sync-state.json', '.crucible/forge.config.yaml'])(
  'AC-7 handled replacement failure after %s restores target and exact legacy state/config bytes',
  async (failedPath) => {
    const root = dir(),
      {dependencies, legacy} = await handlerFixture(root)
    const before = await protectedBytes(root)
    let injected = false
    const transaction = {
      ...transactionIO,
      replace: async (...args: Parameters<typeof transactionIO.replace>) => {
        await transactionIO.replace(...args)
        if (!injected && args[1].replaceAll('\\', '/').endsWith(`/${failedPath}`)) {
          injected = true
          throw new Error('failure after replacement')
        }
      },
    }
    await runSyncWithDependencies(options, {...dependencies, transaction})
    expect(injected).toBe(true)
    expect(process.exitCode).toBe(1)
    expect(await protectedBytes(root)).toEqual(before)
    expect(await readFile(join(root, '.crucible/sync-state.json'), 'utf8')).toBe(legacy)
  },
)
it('AC-7 incomplete compensation identifies untrusted state rather than claiming timestamp consistency', async () => {
  const root = dir(),
    {dependencies, legacy} = await handlerFixture(root)
  let restoring = false
  const transaction = {
    ...transactionIO,
    replace: async (...args: Parameters<typeof transactionIO.replace>) => {
      if (args[1].endsWith('forge.config.yaml') && !restoring) {
        restoring = true
        throw new Error('config failed')
      }
      if (args[1].endsWith('sync-state.json') && restoring) throw new Error('state restore failed')
      await transactionIO.replace(...args)
    },
  }
  const stderr = spyOn(console, 'error').mockImplementation(() => {})
  try {
    await runSyncWithDependencies(options, {...dependencies, transaction})
    expect(process.exitCode).toBe(1)
    expect(stderr.mock.calls.flat().join(' ')).toContain('unrestored/untrusted paths: .crucible/sync-state.json')
    expect(await readFile(join(root, '.crucible/sync-state.json'), 'utf8')).not.toBe(legacy)
    expect(await readFile(join(root, trackedPath), 'utf8')).toBe('before')
  } finally {
    stderr.mockRestore()
  }
})
