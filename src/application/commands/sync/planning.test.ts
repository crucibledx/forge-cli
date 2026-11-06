import {readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {applySyncPlan as executePlan, protectedBytes, syncFixture, trackedPath} from '@test-helpers/sync-fixture'
import {buildSyncState} from '@test-helpers/sync-state'
import {useTmpDir} from '@test-helpers/tmp'
import {expect, it} from 'bun:test'

import {SYNC_CONFIG_DEFAULTS} from '@domain/config/types'

import {buildPlan} from './handler'
const dir = useTmpDir('injected-planning')
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
