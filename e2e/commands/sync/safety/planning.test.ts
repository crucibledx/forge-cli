import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {syncFixture, trackedPath} from '@test-helpers/sync-fixture'
import {protectedBytes} from '@test-helpers/sync-fixture'
import {useTmpDir} from '@test-helpers/tmp'
import {expect, it} from 'bun:test'

import {command, config} from './helpers'

const dir = useTmpDir('planning-contract')
it('AC-9 real CLI refuses a different backup without installing a valid neighbor', async () => {
  const root = dir()
  await syncFixture(root)
  await mkdir(join(root, 'upstream/rules'), {recursive: true})
  await writeFile(join(root, 'upstream/rules/a.md'), 'after')
  await writeFile(join(root, 'upstream/rules/neighbor.md'), 'new neighbor')
  await writeFile(join(root, `${trackedPath}.bak`), 'retained sentinel')
  const before = await protectedBytes(root)
  expect((await command(root)).exitCode).toBe(1)
  expect(await protectedBytes(root)).toEqual(before)
})
it.each(['first-wins', 'last-wins'] as const)(
  'AC-9 exact-path source precedence remains intentional: %s',
  async (policy) => {
    const root = dir()
    const sources = []
    for (const name of ['first', 'last']) {
      const path = join(root, name)
      await mkdir(join(path, 'rules'), {recursive: true})
      await writeFile(join(path, 'rules/a.md'), name)
      sources.push({name, path, type: 'local' as const})
    }
    await config(root, sources, {source_conflict_strategy: policy})
    expect((await command(root)).exitCode).toBe(0)
    expect(await readFile(join(root, trackedPath), 'utf8')).toBe(policy === 'first-wins' ? 'first' : 'last')
  },
)
