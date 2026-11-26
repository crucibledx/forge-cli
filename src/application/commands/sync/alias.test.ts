import {readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {handlerFixture, protectedBytes, trackedPath} from '@test-helpers/sync-fixture'
import {useTmpDir} from '@test-helpers/tmp'
import {afterEach, expect, it} from 'bun:test'

import {transactionIO} from '@infrastructure/fs/transaction'

import {runSyncWithDependencies} from './handler'

const dir = useTmpDir('sync-alias')
const options = {dryRun: false, verbose: false, silent: true}
const CONFIG = '.crucible/forge.config.yaml'
afterEach(() => {
  process.exitCode = 0
})

async function aliasFixture(root: string) {
  const fixture = await handlerFixture(root)
  const original = (await readFile(join(root, CONFIG), 'utf-8')).replace(/^harnesses:/m, '# legacy key\nassistants:')
  await writeFile(join(root, CONFIG), original)
  return {...fixture, original}
}

it('renames the alias key and then writes the synced config', async () => {
  const root = dir(),
    {dependencies} = await aliasFixture(root)
  await runSyncWithDependencies(options, dependencies)
  expect(process.exitCode ?? 0).toBe(0)
  const config = await readFile(join(root, CONFIG), 'utf-8')
  expect(config).toContain('harnesses:')
  expect(config).not.toContain('assistants')
  expect(await readFile(join(root, trackedPath), 'utf-8')).toBe('after')
})

it('leaves the alias config untouched in a dry run', async () => {
  const root = dir(),
    {dependencies, original} = await aliasFixture(root)
  await runSyncWithDependencies({...options, dryRun: true}, dependencies)
  expect(await readFile(join(root, CONFIG), 'utf-8')).toBe(original)
})

it.each([
  ['the alias rename', 1],
  [trackedPath, 1],
  ['.crucible/sync-state.json', 1],
  [CONFIG, 2],
])('a failure after %s restores the original alias config and every protected byte', async (failedPath, nth) => {
  const root = dir(),
    {dependencies, original} = await aliasFixture(root)
  const before = await protectedBytes(root)
  const target = failedPath === 'the alias rename' ? CONFIG : failedPath
  let seen = 0
  let injected = false
  const transaction = {
    ...transactionIO,
    replace: async (...args: Parameters<typeof transactionIO.replace>) => {
      await transactionIO.replace(...args)
      if (!injected && args[1].replaceAll('\\', '/').endsWith(`/${target}`) && ++seen === nth) {
        injected = true
        throw new Error('failure after replacement')
      }
    },
  }
  await runSyncWithDependencies(options, {...dependencies, transaction})
  expect(injected).toBe(true)
  expect(process.exitCode).toBe(1)
  expect(await readFile(join(root, CONFIG), 'utf-8')).toBe(original)
  expect(await protectedBytes(root)).toEqual(before)
})
