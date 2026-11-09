import {existsSync} from 'node:fs'
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {syncFixture, trackedPath} from '@test-helpers/sync-fixture'
import {protectedBytes} from '@test-helpers/sync-fixture'
import {useTmpDir} from '@test-helpers/tmp'
import {expect, it} from 'bun:test'

import {command, config} from './helpers'

const dir = useTmpDir('planning-contract')
it.each([
  ['Foo', 'foo'],
  ['café', 'cafe\u0301'],
])(
  'AC-8,9 fresh-root directory aliases fail identically before preview/apply writes: %s / %s',
  async (first, second) => {
    const sources = []
    for (const [index, name] of [first, second].entries()) {
      const path = join(dir(), `source-${index}`)
      await mkdir(join(path, 'skills', name), {recursive: true})
      await writeFile(join(path, 'skills', name, `${index}.md`), 'incoming')
      sources.push({name: `source-${index}`, path, type: 'local' as const})
    }
    await mkdir(join(sources[0].path, 'rules'), {recursive: true})
    await writeFile(join(sources[0].path, 'rules/neighbor.md'), 'valid changed neighbor')
    const refusals = []
    for (const dryRun of [true, false]) {
      const root = join(dir(), dryRun ? 'preview' : 'apply')
      await config(root, sources)
      const before = await protectedBytes(root)
      const result = await command(root, dryRun ? ['sync', '--dry-run'] : ['sync'])
      expect(result.exitCode).toBe(1)
      expect(result.output).toContain('aliased directories')
      expect(await protectedBytes(root)).toEqual(before)
      expect(existsSync(join(root, '.claude'))).toBe(false)
      refusals.push(result.output.match(/Competing or aliased directories:[^\r\n]+/)?.[0])
    }
    expect(refusals[0]).toBeTruthy()
    expect(refusals[0]).toBe(refusals[1])
  },
)
it('AC-8,9 identically spelled shared directories remain valid through fresh-root preview and apply', async () => {
  const sources = []
  for (const index of [0, 1]) {
    const path = join(dir(), `source-${index}`)
    await mkdir(join(path, 'skills/Foo'), {recursive: true})
    await writeFile(join(path, `skills/Foo/${index}.md`), `source-${index}`)
    sources.push({name: `source-${index}`, path, type: 'local' as const})
  }
  const root = join(dir(), 'target')
  await config(root, sources)
  const before = await protectedBytes(root)
  expect((await command(root, ['sync', '--dry-run'])).exitCode).toBe(0)
  expect(await protectedBytes(root)).toEqual(before)
  expect(existsSync(join(root, '.claude'))).toBe(false)
  expect((await command(root)).exitCode).toBe(0)
  for (const index of [0, 1])
    expect(await readFile(join(root, `.claude/skills/Foo/${index}.md`), 'utf8')).toBe(`source-${index}`)
})
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
