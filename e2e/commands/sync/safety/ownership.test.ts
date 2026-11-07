import {existsSync} from 'node:fs'
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {snapshot} from '@test-helpers/snapshot'
import {syncFixture, trackedPath} from '@test-helpers/sync-fixture'
import {useTmpDir} from '@test-helpers/tmp'
import {expect, it} from 'bun:test'

import type {SyncState} from '@domain/sync/state'
import {hashContent} from '@domain/sync/state'

import {command, config} from './helpers'

const dir = useTmpDir('cli-stale-matrix')
for (const kind of ['installed-edited', 'legacy-edited', 'legacy-hash-equal'])
  for (const strategy of ['local-wins', 'error', 'remote-wins'] as const)
    for (const backup of [false, true])
      it(`AC-5 real CLI stale ${kind}, strategy=${strategy}, backup=${backup}`, async () => {
        const root = dir()
        await syncFixture(root)
        await mkdir(join(root, 'upstream'), {recursive: true})
        await config(root, [{name: 'empty', type: 'local', path: join(root, 'upstream')}], {
          keep_local: false,
          local_conflict_strategy: strategy,
          backup,
        })
        const state: SyncState = {
          version: 2,
          lastSync: '2026-01-01T00:00:00.000Z',
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
        await writeFile(join(root, '.claude/rules/user.md'), 'untracked sentinel')
        const before = await snapshot(root)
        const result = await command(root)
        expect(result.exitCode).toBe(strategy === 'error' ? 1 : 0)
        if (strategy === 'error') expect(await snapshot(root)).toEqual(before)
        else {
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
