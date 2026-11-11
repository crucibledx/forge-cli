import {existsSync} from 'node:fs'
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {snapshot} from '@test-helpers/snapshot'
import {syncFixture, trackedPath} from '@test-helpers/sync-fixture'
import {useTmpDir} from '@test-helpers/tmp'
import {expect, it} from 'bun:test'

import type {SyncState} from '@domain/sync/state'
import {hashContent} from '@domain/sync/state'

import {command, config, nativePairBytes, readNativePair, writeAmbiguousPair} from './helpers'

const dir = useTmpDir('cli-stale-matrix')
// Inside an assistant destination, and outside every destination where only uninstall/source cleanup would reach it.
for (const literal of ['.claude/skills/a\\b.md', 'notes/a\\b.md'])
  for (const current of [false, true])
    for (const backup of [false, true])
      for (const args of [['sync'], ['sync', '--dry-run'], ['sync', '--silent'], ['sync', '--silent', '--dry-run']])
        it.skipIf(process.platform === 'win32')(
          `AC-5/6 ambiguous POSIX ownership refuses repeatedly without mutation, path=${literal} v2=${current} backup=${backup} ${args.join(' ')}`,
          async () => {
            const root = dir()
            await syncFixture(root)
            await mkdir(join(root, 'upstream'), {recursive: true})
            const paths = await writeAmbiguousPair(root, literal)
            await config(root, [{name: 'team', type: 'local', path: join(root, 'upstream')}], {
              keep_local: false,
              local_conflict_strategy: 'remote-wins',
              backup,
            })
            const raw = JSON.stringify({
              ...(current ? {version: 2} : {}),
              lastSync: '',
              files: {
                [literal]: {
                  hash: hashContent('literal owned bytes'),
                  sourceName: 'team',
                  ...(current ? {baseline: 'installed'} : {}),
                },
              },
            })
            await writeFile(join(root, '.crucible/sync-state.json'), raw)
            const before = await snapshot(root)
            for (let run = 0; run < 2; run++) {
              const result = await command(root, args)
              expect(result, JSON.stringify(result)).toMatchObject({exitCode: 1, signal: null, timedOut: false})
              if (!args.includes('--silent'))
                expect(result.stdout + result.stderr).toContain('Ambiguous tracked backslash path')
              expect(await snapshot(root)).toEqual(before)
              expect(await readFile(join(root, '.crucible/sync-state.json'), 'utf8')).toBe(raw)
              expect(await readNativePair(root, paths)).toMatchObject({
                exitCode: 0,
                signal: null,
                timedOut: false,
                stdout: nativePairBytes,
              })
            }
          },
        )
it('AC-5/6 Windows legacy separators keep ordinary stale cleanup and backup across repeated sync', async () => {
  const root = dir()
  await syncFixture(root)
  await mkdir(join(root, 'upstream'), {recursive: true})
  await config(root, [{name: 'team', type: 'local', path: join(root, 'upstream')}], {
    keep_local: false,
    local_conflict_strategy: 'remote-wins',
    backup: true,
  })
  const windowsKey = trackedPath.replaceAll('/', '\\')
  await writeFile(
    join(root, '.crucible/sync-state.json'),
    JSON.stringify({lastSync: '', files: {[windowsKey]: {hash: hashContent('before'), sourceName: 'team'}}}),
  )
  await writeFile(join(root, '.claude/rules/user.md'), 'untracked sentinel')
  for (let run = 0; run < 2; run++) {
    const result = await command(root)
    expect(result, JSON.stringify(result)).toMatchObject({exitCode: 0, signal: null, timedOut: false})
    expect(existsSync(join(root, trackedPath))).toBe(false)
    expect(await readFile(join(root, `${trackedPath}.bak`), 'utf8')).toBe('before')
    expect(JSON.parse(await readFile(join(root, '.crucible/sync-state.json'), 'utf8')).files).toEqual({})
    expect(await readFile(join(root, '.claude/rules/user.md'), 'utf8')).toBe('untracked sentinel')
  }
})
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
