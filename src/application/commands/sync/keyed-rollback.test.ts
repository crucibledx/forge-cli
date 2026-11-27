import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {snapshot} from '@test-helpers/snapshot'
import {applySyncPlan, syncFixture} from '@test-helpers/sync-fixture'
import {buildSyncState} from '@test-helpers/sync-state'
import {useTmpDir} from '@test-helpers/tmp'
import {describe, expect, it} from 'bun:test'

import {SYNC_CONFIG_DEFAULTS} from '@domain/config/types'
import {withKeyedEntries} from '@domain/sync/state'
import {transactionIO} from '@infrastructure/fs/transaction'

import {buildPlan} from './handler'

/** Planning-level half of AC-14; the full-CLI half is e2e/commands/sync/plugin-rollback.test.ts. */
describe('AC-14 keyed-merge rollback (planning level)', () => {
  const dir = useTmpDir('sync-keyed-rollback')

  it('restores the pre-run snapshot, settings file included, when a later commit step fails', async () => {
    const root = dir()
    const {context, legacy} = await syncFixture(root)
    const settingsPath = '.factory/settings.local.json'
    const original = '{\n  "model": "small"\n}\n'
    await mkdir(join(root, '.factory'), {recursive: true})
    await writeFile(join(root, settingsPath), original)
    const before = await snapshot(root)

    const plan = await buildPlan(root, [], {lastSync: '', files: {}}, {...SYNC_CONFIG_DEFAULTS}, new Set(['droid']), {
      keyed: [
        {
          path: settingsPath,
          sourceName: 'plugins',
          values: [
            {
              key: {kind: 'member', path: ['extraKnownMarketplaces', 'crucible-forge-test']},
              value: {source: {source: 'local', path: '/cache'}},
            },
            {key: {kind: 'member', path: ['enabledPlugins', 'hello@crucible-forge-test']}, value: true},
          ],
        },
      ],
      files: [{path: '.crucible/plugins/hello/1.0.0/droid/skills/hello/SKILL.md', content: '# Hello'}],
    })
    expect(plan.mutations.some((mutation) => mutation.type === 'keyed_merge')).toBe(true)

    const next = withKeyedEntries(buildSyncState([]), plan.keyed)
    let failed = false
    const fs = {
      ...transactionIO,
      replace: async (...args: Parameters<typeof transactionIO.replace>) => {
        if (!failed && args[1].endsWith('forge.config.yaml')) {
          failed = true
          throw new Error('config commit failed')
        }
        await transactionIO.replace(...args)
      },
    }
    await expect(applySyncPlan(root, plan.mutations, next, context, fs)).rejects.toThrow('Rollback complete')

    expect(await snapshot(root)).toEqual(before)
    expect(await readFile(join(root, settingsPath), 'utf8')).toBe(original)
    expect(await readFile(join(root, '.crucible/sync-state.json'), 'utf8')).toBe(legacy)
  })
})
