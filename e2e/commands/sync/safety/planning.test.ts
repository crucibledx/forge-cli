import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {applySyncPlan as executePlan, syncFixture, trackedPath} from '@test-helpers/sync-fixture'
import {buildSyncState} from '@test-helpers/sync-state'
import {useTmpDir} from '@test-helpers/tmp'
import {expect, it} from 'bun:test'

import {SYNC_CONFIG_DEFAULTS} from '@domain/config/types'
import {buildPlan} from '@application/commands/sync/handler'

import {command, config, protectedBytes} from './helpers'

const dir = useTmpDir('planning-contract')
const target = (targetPath: string, content = 'incoming') => ({
  targetPath,
  content,
  sourcePath: 'rules/incoming.md',
  sourceName: 'team',
  assistantId: 'claude-code',
})
const collisions = [
  ['case alias', '.claude/rules/A.md', '.claude/rules/a.md'],
  ['NFC alias', '.claude/rules/café.md', '.claude/rules/cafe\u0301.md'],
  ['file ancestor', '.claude/rules/node', '.claude/rules/node/leaf.md'],
  ['state metadata', '.crucible/sync-state.json'],
  ['config metadata', '.crucible/forge.config.yaml'],
  ['generated backup/source target', trackedPath, `${trackedPath}.bak`],
]
it.each(collisions)('AC-9 rejects %s with a valid changed neighbor before any filesystem mutation', async (...row) => {
  const root = dir()
  await syncFixture(root)
  const before = await protectedBytes(root)
  const targets = [target('.claude/rules/neighbor.md'), ...row.slice(1).map((path) => target(path))]
  await expect(buildPlan(root, targets, {lastSync: '', files: {}}, SYNC_CONFIG_DEFAULTS)).rejects.toThrow()
  expect(await protectedBytes(root)).toEqual(before)
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
it('AC-9 identical backups are reused while the target and neighbor commit', async () => {
  const root = dir(),
    {context} = await syncFixture(root)
  await writeFile(join(root, `${trackedPath}.bak`), 'before')
  const targets = [target(trackedPath, 'after'), target('.claude/rules/neighbor.md')]
  const plan = await buildPlan(root, targets, {lastSync: '', files: {}}, SYNC_CONFIG_DEFAULTS)
  await executePlan(root, plan.mutations, buildSyncState(targets), context)
  expect(await readFile(join(root, trackedPath), 'utf8')).toBe('after')
  expect(await readFile(join(root, `${trackedPath}.bak`), 'utf8')).toBe('before')
  expect(await readFile(join(root, '.claude/rules/neighbor.md'), 'utf8')).toBe('incoming')
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
