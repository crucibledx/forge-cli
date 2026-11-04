import {mkdir, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {syncFixture, trackedPath} from '@test-helpers/sync-fixture'
import {useTmpDir} from '@test-helpers/tmp'
import {expect, it} from 'bun:test'

import {hashContent} from '@domain/sync/state'

import {command, config, protectedBytes} from './helpers'

const dir = useTmpDir('legacy-upgrade')
it('BR-04 legacy desired-hash entries remain unknown in status/preview and exact bytes survive conflict failure (AC-6)', async () => {
  const root = dir()
  await syncFixture(root)
  await mkdir(join(root, 'upstream/rules'), {recursive: true})
  await writeFile(join(root, 'upstream/rules/a.md'), 'desired')
  await writeFile(join(root, trackedPath), 'local skipped edit')
  await writeFile(
    join(root, '.crucible/sync-state.json'),
    JSON.stringify(
      {
        lastSync: '2026-01-01T00:00:00.000Z',
        files: {[trackedPath]: {hash: hashContent('desired'), sourceName: 'team'}},
      },
      null,
      4,
    ) + '\n',
  )
  await config(root, [{name: 'team', type: 'local', path: join(root, 'upstream')}], {local_conflict_strategy: 'error'})
  const before = await protectedBytes(root)
  const status = await command(root, ['status'])
  expect(status.exitCode).toBe(0)
  expect(status.stdout).toContain('legacy-unknown baseline')
  expect(await protectedBytes(root)).toEqual(before)
  for (const args of [['sync', '--dry-run'], ['sync']]) {
    expect((await command(root, args)).exitCode).toBe(1)
    expect(await protectedBytes(root)).toEqual(before)
  }
})
