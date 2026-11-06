import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {dirname, join} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {expect, it} from 'bun:test'

import {getAllAssistants} from '@domain/assistants'
import {SYNC_CONFIG_DEFAULTS} from '@domain/config/types'
import {hashContent} from '@domain/sync/state'
import {runPipe} from '@e2e/framework/pipe'

import {testEnvironment} from '../../../../scripts/test-sandbox'

const dir = useTmpDir('cli-ownership')
for (const global of [false, true])
  for (const keep_local of [false, true])
    for (let index = 0; index < 5; index++)
      it(`AC-4,26 real CLI retains disabled/removed/unknown ownership, global=${global}, assistant=${index}, keep_local=${keep_local}`, async () => {
        const cwd = dir(),
          root = global ? testEnvironment(cwd).HOME : cwd
        const all = getAllAssistants()
        const destination = (assistant: (typeof all)[number]) => {
          const mapping = assistant.targetMappings[0].destination
          return `${(global ? (mapping.global ?? mapping.project) : mapping.project).replace(/\/$/, '')}/retained.md`
        }
        const paths = [destination(all[index]), destination(all[(index + 1) % 5]), 'unknown/retained.md']
        const files = Object.fromEntries(
          paths.map((path) => [
            path,
            {hash: hashContent(`unchanged ${path}`), sourceName: 'removed-source', baseline: 'installed'},
          ]),
        )
        for (const path of paths) {
          await mkdir(dirname(join(root, path)), {recursive: true})
          await writeFile(join(root, path), `unchanged ${path}`)
        }
        await mkdir(join(root, '.crucible'), {recursive: true})
        await mkdir(join(root, 'upstream'), {recursive: true})
        await writeFile(
          join(root, '.crucible/sync-state.json'),
          JSON.stringify({version: 2, lastSync: '2026-01-01T00:00:00.000Z', files}),
        )
        await writeFile(
          join(root, '.crucible/forge.config.yaml'),
          JSON.stringify({
            version: '1',
            sources: [{name: 'empty', type: 'local', path: join(root, 'upstream')}],
            sync: {...SYNC_CONFIG_DEFAULTS, keep_local},
            assistants: [
              {id: all[index].id, enabled: false},
              {id: all[(index + 2) % 5].id, enabled: true},
            ],
          }),
        )
        const cli = join(import.meta.dir, '../../../../src/main.ts')
        expect(
          (await runPipe(cwd, [process.execPath, cli, ...(global ? ['--global'] : []), 'sync', '--silent'])).exitCode,
        ).toBe(0)
        expect(JSON.parse(await readFile(join(root, '.crucible/sync-state.json'), 'utf8')).files).toEqual(files)
        for (const path of paths) expect(await readFile(join(root, path), 'utf8')).toBe(`unchanged ${path}`)
      })
