import {mkdir, rename, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {snapshot} from '@test-helpers/snapshot'
import {trackedPath} from '@test-helpers/sync-fixture'
import {useTmpDir} from '@test-helpers/tmp'
import {expect, it} from 'bun:test'

import {testEnvironment} from '../../../../scripts/test-sandbox'
import {command, config, protectedBytes} from './helpers'

const dir = useTmpDir('preview-failure')
it('BR-05 failed conflict/source previews leave existing latest/history and protected bytes unchanged (AC-8)', async () => {
  const root = dir(),
    source = join(root, 'upstream')
  await mkdir(join(source, 'rules'), {recursive: true})
  await writeFile(join(source, 'rules/a.md'), 'first')
  await config(root, [{name: 'source', type: 'local', path: source}], {local_conflict_strategy: 'error'})
  expect((await command(root)).exitCode).toBe(0)
  await writeFile(join(root, trackedPath), 'local edit')
  await writeFile(join(source, 'rules/a.md'), 'changed')
  const before = await protectedBytes(root),
    home = testEnvironment(root).HOME
  const reportsBefore = await snapshot(join(home, '.crucible/forge/reports'))
  for (const extra of [[], ['--silent']]) {
    const result = await command(root, ['sync', '--dry-run', ...extra])
    expect(result.exitCode).toBe(1)
    expect(await protectedBytes(root)).toEqual(before)
    expect(await snapshot(join(home, '.crucible/forge/reports'))).toEqual(reportsBefore)
    if (extra.length) {
      expect(result.stdout).toBe('')
      expect(result.stderr).toBe('')
    }
  }
  await rename(source, source + '-missing')
  expect((await command(root, ['sync', '--dry-run'])).exitCode).toBe(1)
  expect(await protectedBytes(root)).toEqual(before)
  expect(await snapshot(join(home, '.crucible/forge/reports'))).toEqual(reportsBefore)
})
