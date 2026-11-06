import {existsSync} from 'node:fs'
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {snapshot} from '@test-helpers/snapshot'
import {applySyncPlan as executePlan, syncFixture, trackedPath} from '@test-helpers/sync-fixture'
import {useTmpDir} from '@test-helpers/tmp'
import {expect, it} from 'bun:test'

import {SYNC_CONFIG_DEFAULTS} from '@domain/config/types'
import {reconcileState} from '@domain/sync/reconcile'
import type {SyncState} from '@domain/sync/state'
import {hashContent} from '@domain/sync/state'
import {buildPlan} from '@application/commands/sync/handler'

const dir = useTmpDir('stale-matrix')
for (const kind of ['installed-edited', 'legacy-edited', 'legacy-hash-equal'])
  for (const strategy of ['local-wins', 'error', 'remote-wins'] as const)
    for (const backup of [false, true])
      it(`BR-03/04 persisted ${kind} stale ${strategy} backup=${backup} (AC-5)`, async () => {
        const root = dir(),
          {context, config} = await syncFixture(root)
        const state: SyncState = {
          version: 2,
          lastSync: config.lastSync!,
          files: {
            [trackedPath]: {
              hash: hashContent(kind === 'legacy-hash-equal' ? 'local' : 'before'),
              sourceName: 'old',
              baseline: kind === 'installed-edited' ? 'installed' : 'legacy-unknown',
            },
          },
        }
        await writeFile(join(root, '.crucible/sync-state.json'), JSON.stringify(state))
        await writeFile(join(root, trackedPath), 'local')
        await mkdir(join(root, '.claude/rules'), {recursive: true})
        await writeFile(join(root, '.claude/rules/user.md'), 'untracked sentinel')
        const before = await snapshot(root)
        const pending = buildPlan(root, [], state, {
          ...SYNC_CONFIG_DEFAULTS,
          ...config.sync,
          keep_local: false,
          local_conflict_strategy: strategy,
          backup,
        })
        if (strategy === 'error') {
          await expect(pending).rejects.toThrow('Local conflict')
          expect(await snapshot(root)).toEqual(before)
        } else {
          const plan = await pending
          await executePlan(
            root,
            plan.mutations,
            reconcileState(state, [], plan.summaries, '2026-11-10T00:00:00.000Z'),
            context,
          )
          expect(existsSync(join(root, trackedPath))).toBe(strategy === 'local-wins')
          const next = JSON.parse(await readFile(join(root, '.crucible/sync-state.json'), 'utf8'))
          if (strategy === 'local-wins') expect(next.files[trackedPath]).toEqual(state.files[trackedPath])
          else expect(next.files[trackedPath]).toBeUndefined()
          expect(existsSync(join(root, trackedPath + '.bak'))).toBe(strategy === 'remote-wins' && backup)
          if (strategy === 'remote-wins' && backup)
            expect(await readFile(join(root, trackedPath + '.bak'), 'utf8')).toBe('local')
        }
        expect(await readFile(join(root, '.claude/rules/user.md'), 'utf8')).toBe('untracked sentinel')
      })
