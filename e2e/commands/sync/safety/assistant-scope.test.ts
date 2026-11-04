import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {dirname, join} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {afterEach, expect, it} from 'bun:test'

import {assistantsRegistry, getAllAssistants} from '@domain/assistants'
import {type ProjectConfig, SYNC_CONFIG_DEFAULTS} from '@domain/config/types'
import {setGlobalMode} from '@domain/scope'
import {hashContent} from '@domain/sync/state'
import {runSyncWithDependencies} from '@application/commands/sync/handler'

const dir = useTmpDir('persisted-ownership')
afterEach(() => {
  setGlobalMode(false)
  process.exitCode = 0
})
for (const global of [false, true])
  for (const keep_local of [false, true])
    for (let index = 0; index < 5; index++)
      it(`BR-02 retained disabled/removed/unknown/ambiguous entries, scope=${global ? 'global' : 'project'}, owner=${index}, keep_local=${keep_local} (AC-4,26)`, async () => {
        const root = dir(),
          all = getAllAssistants(),
          disabled = all[index],
          removed = all[(index + 1) % 5],
          ambiguous = all[(index + 2) % 5]
        setGlobalMode(global)
        const destination = (assistant: typeof disabled) => {
          const mapping = assistant.targetMappings[0].destination
          return `${(global ? (mapping.global ?? mapping.project) : mapping.project).replace(/\/$/, '')}/retained.md`
        }
        const paths = [destination(disabled), destination(removed), 'unknown/retained.md', destination(ambiguous)]
        const files = Object.fromEntries(
          paths.map((path) => [
            path,
            {hash: hashContent(`unchanged ${path}`), sourceName: 'removed-source', baseline: 'installed' as const},
          ]),
        )
        for (const path of paths) {
          await mkdir(dirname(join(root, path)), {recursive: true})
          await writeFile(join(root, path), `unchanged ${path}`)
        }
        await mkdir(join(root, '.crucible'))
        await writeFile(
          join(root, '.crucible/sync-state.json'),
          JSON.stringify({version: 2, lastSync: '2026-01-01T00:00:00.000Z', files}),
        )
        const config: ProjectConfig = {
          version: '1',
          sources: [{name: 'empty', type: 'local', path: root}],
          sync: {...SYNC_CONFIG_DEFAULTS, keep_local},
          assistants: [
            {id: disabled.id, enabled: false},
            {id: ambiguous.id, enabled: true},
          ],
        }
        await writeFile(join(root, '.crucible/forge.config.yaml'), 'original config')
        assistantsRegistry.push({...ambiguous, id: 'ambiguous-fixture'})
        try {
          await runSyncWithDependencies(
            {dryRun: false, verbose: false, silent: true},
            {
              io: {
                resolveProjectRoot: () => root,
                buildContext: async () => ({projectRoot: root, projectConfig: config, hasProjectConfig: true}),
              },
              loadSource: async () => [],
              reports: {
                writeReport: async () => {},
                rotate: async () => {},
                readLatest: async () => null,
                readHistory: async () => [],
                getReportDir: () => root,
              },
            },
          )
          expect(process.exitCode ?? 0).toBe(0)
          const next = JSON.parse(await readFile(join(root, '.crucible/sync-state.json'), 'utf8'))
          expect(next.files).toEqual(files)
          for (const path of paths) expect(await readFile(join(root, path), 'utf8')).toBe(`unchanged ${path}`)
        } finally {
          assistantsRegistry.pop()
        }
      })
