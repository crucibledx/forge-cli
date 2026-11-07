import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {protectedBytes, syncFixture, trackedPath} from '@test-helpers/sync-fixture'
import {useTmpDir} from '@test-helpers/tmp'
import {expect, it} from 'bun:test'
import {parse} from 'yaml'

import {command} from './helpers'

const dir = useTmpDir('state-contract')
it.each(
  [false, true].flatMap((current) =>
    [false, true].flatMap((malformed) => [false, true].map((preview) => ({current, malformed, preview}))),
  ),
)(
  'AC-6 raw own __proto__ state refuses mutation: current=$current malformed=$malformed preview=$preview',
  async ({current, malformed, preview}) => {
    const root = dir()
    const {legacy} = await syncFixture(root)
    await mkdir(join(root, 'upstream/rules'), {recursive: true})
    await writeFile(join(root, 'upstream/rules/a.md'), 'before')
    expect((await command(root, ['sync', '--dry-run'])).exitCode).toBe(0)
    const known = {...JSON.parse(legacy).files[trackedPath], ...(current ? {baseline: 'installed'} : {})}
    const entry = {hash: '0'.repeat(64), sourceName: 'unknown-owner', ...(current ? {baseline: 'installed'} : {})}
    const raw = `{"lastSync":"","files":{${JSON.stringify(trackedPath)}:${JSON.stringify(known)},"__proto__":${malformed ? 'null' : JSON.stringify(entry)}}${current ? ',"version":2' : ''}}`
    await writeFile(join(root, '.crucible/sync-state.json'), raw)
    await writeFile(join(root, '__proto__'), 'protected unknown-owner bytes')
    const before = await protectedBytes(root)
    const result = await command(root, ['sync', ...(preview ? ['--dry-run'] : [])])
    expect(result.exitCode).toBe(1)
    expect(result.stdout + result.stderr).toContain('Unsupported tracked state path: __proto__')
    expect(await protectedBytes(root)).toEqual(before)
    expect(await readFile(join(root, '__proto__'), 'utf8')).toBe('protected unknown-owner bytes')
    expect(await readFile(join(root, '.crucible/sync-state.json'), 'utf8')).toBe(raw)
  },
)
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
