import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {syncFixture, trackedPath} from '@test-helpers/sync-fixture'
import {useTmpDir} from '@test-helpers/tmp'
import {expect, it} from 'bun:test'
import {parse} from 'yaml'

import {command} from './helpers'

const dir = useTmpDir('state-contract')
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
