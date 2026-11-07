import {writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {protectedBytes, syncFixture} from '@test-helpers/sync-fixture'
import {useTmpDir} from '@test-helpers/tmp'
import {afterEach, expect, it} from 'bun:test'
import {stringify} from 'yaml'

import type {SyncReport} from '@domain/sync/report'

import {runSyncWithDependencies} from './handler'

const dir = useTmpDir('resolution-failure')
afterEach(() => {
  process.exitCode = 0
})
it.each(['alone', 'all-failed', 'changed-neighbor'])(
  'BR-01 injected resolver-boundary failure %s aborts the integrated handler after collecting all loads (AC-2)',
  async (mode) => {
    const root = dir(),
      {context} = await syncFixture(root)
    const names = ['failed', ...(mode === 'all-failed' ? ['also-failed'] : mode === 'changed-neighbor' ? ['good'] : [])]
    context.projectConfig.sources = names.map((name) => ({name, type: 'local', path: join(root, name)}))
    await writeFile(join(root, '.crucible/forge.config.yaml'), stringify(context.projectConfig))
    const before = await protectedBytes(root),
      attempted: string[] = [],
      reports: SyncReport[] = []
    await runSyncWithDependencies(
      {dryRun: false, silent: true, verbose: false},
      {
        io: {resolveProjectRoot: () => root, buildContext: async () => context},
        loadSource: async (source) => {
          attempted.push(source.name)
          if (source.name === 'good') return [{relativePath: 'rules/a.md', content: 'changed neighbor'}]
          // Acquisition succeeds. Reading the resolved content raises an injected
          // domain-boundary fault, not a hidden production environment switch.
          return [
            {
              relativePath: 'rules/a.md',
              get content(): string {
                throw new Error(`resolution failed for ${source.name}`)
              },
            },
          ]
        },
        reports: {
          writeReport: async (report) => {
            reports.push(report)
          },
          rotate: async () => {},
          readLatest: async () => null,
          readHistory: async () => [],
          getReportDir: () => root,
        },
      },
    )
    expect(process.exitCode).toBe(1)
    expect(attempted).toEqual(names)
    expect(await protectedBytes(root)).toEqual(before)
    expect(reports[0].success).toBe(false)
    expect(reports[0].files.synced).toBe(0)
    expect(reports[0].files.errors).toBe(mode === 'all-failed' ? 2 : 1)
    for (const name of names.filter((name) => name !== 'good')) expect(reports[0].error).toContain(name)
  },
)
