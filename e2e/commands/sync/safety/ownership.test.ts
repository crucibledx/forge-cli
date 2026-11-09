import {existsSync} from 'node:fs'
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {snapshot} from '@test-helpers/snapshot'
import {syncFixture, trackedPath} from '@test-helpers/sync-fixture'
import {useTmpDir} from '@test-helpers/tmp'
import {expect, it} from 'bun:test'

import type {SyncState} from '@domain/sync/state'
import {hashContent} from '@domain/sync/state'

import {runPipe} from '../../../framework/pipe'
import {command, config} from './helpers'

const dir = useTmpDir('cli-stale-matrix')
for (const current of [false, true])
  for (const args of [['sync'], ['sync', '--dry-run'], ['sync', '--silent'], ['sync', '--silent', '--dry-run']])
    it.skipIf(process.platform === 'win32')(
      `AC-5/6 ambiguous POSIX ownership refuses without mutation, v2=${current} ${args.join(' ')}`,
      async () => {
        const root = dir()
        await syncFixture(root)
        await mkdir(join(root, 'upstream'), {recursive: true})
        await mkdir(join(root, '.claude/skills/a'), {recursive: true})
        const paths = [join(root, '.claude/skills/a\\b.md'), join(root, '.claude/skills/a/b.md')]
        // Bun's file APIs normalize backslashes on POSIX. Construct and inspect both real names natively.
        const inspect = '/bin/cat "$1"; printf "\\n"; /bin/cat "$2"; printf "\\n"'
        const native = await runPipe(root, [
          '/bin/sh',
          '-c',
          'printf "%s" "literal owned bytes" > "$1" && printf "%s" "UNTRACKED USER BYTES" > "$2" && ' + inspect,
          'forge-native-fixture',
          ...paths,
        ])
        expect(native).toMatchObject({
          exitCode: 0,
          signal: null,
          timedOut: false,
          stdout: 'literal owned bytes\nUNTRACKED USER BYTES\n',
        })
        await config(root, [{name: 'team', type: 'local', path: join(root, 'upstream')}], {
          keep_local: false,
          local_conflict_strategy: 'remote-wins',
          backup: false,
        })
        await writeFile(
          join(root, '.crucible/sync-state.json'),
          JSON.stringify({
            ...(current ? {version: 2} : {}),
            lastSync: '',
            files: {
              '.claude/skills/a\\b.md': {
                hash: hashContent('literal owned bytes'),
                sourceName: 'team',
                ...(current ? {baseline: 'installed'} : {}),
              },
            },
          }),
        )
        const before = await snapshot(root)
        const result = await command(root, args)
        expect(result, JSON.stringify(result)).toMatchObject({exitCode: 1, signal: null, timedOut: false})
        expect(await snapshot(root)).toEqual(before)
        const after = await runPipe(root, ['/bin/sh', '-c', inspect, 'forge-native-fixture', ...paths])
        expect(after).toMatchObject({exitCode: 0, signal: null, timedOut: false, stdout: native.stdout})
      },
    )
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
