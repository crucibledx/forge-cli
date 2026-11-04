import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {syncFixture, trackedPath} from '@test-helpers/sync-fixture'
import {useTmpDir} from '@test-helpers/tmp'
import {afterEach, expect, it, spyOn} from 'bun:test'
import {parse} from 'yaml'

import {runSyncWithDependencies} from '@application/commands/sync/handler'
import {transactionIO} from '@infrastructure/fs/transaction'

import {command, handlerFixture, protectedBytes} from './helpers'

const dir = useTmpDir('state-contract')
const options = {dryRun: false, verbose: false, silent: true}
afterEach(() => {
  process.exitCode = 0
})
it('AC-7 real CLI advances state/config timestamps together on apply and no-op', async () => {
  const root = dir()
  const {config} = await syncFixture(root)
  await mkdir(join(root, 'upstream/rules'), {recursive: true})
  await writeFile(join(root, 'upstream/rules/a.md'), 'after')
  let previous = config.lastSync
  for (let run = 0; run < 2; run++) {
    expect((await command(root)).exitCode).toBe(0)
    const state = JSON.parse(await readFile(join(root, '.crucible/sync-state.json'), 'utf8'))
    const saved = parse(await readFile(join(root, '.crucible/forge.config.yaml'), 'utf8'))
    expect(state.lastSync).toBe(saved.lastSync)
    expect(state.lastSync).not.toBe(previous)
    expect(Number.isFinite(Date.parse(state.lastSync))).toBe(true)
    previous = state.lastSync
    expect(await readFile(join(root, trackedPath), 'utf8')).toBe('after')
    expect(await readFile(join(root, `${trackedPath}.bak`), 'utf8')).toBe('before')
  }
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
