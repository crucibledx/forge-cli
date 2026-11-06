import {existsSync} from 'node:fs'
import {mkdir, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import type {ProjectConfig} from '@domain/config/types'
import {SYNC_CONFIG_DEFAULTS} from '@domain/config/types'
import type {SyncReport} from '@domain/sync/report'
import {hashContent} from '@domain/sync/state'
import {commitPrepared, prepareSync} from '@application/commands/sync/handler'
import {writeProjectConfig} from '@infrastructure/config/writer'

import {snapshot} from './snapshot'

/** Test convenience only; these are the same prepare/commit steps used by the command. */
export const applySyncPlan = (...args: Parameters<typeof prepareSync>) => prepareSync(...args).then(commitPrepared)

export const trackedPath = '.claude/rules/a.md'
export async function syncFixture(root: string) {
  const config: ProjectConfig = {
    version: '1',
    sources: [{name: 'team', type: 'local', path: join(root, 'upstream')}],
    assistants: [{id: 'claude-code', enabled: true}],
    sync: {...SYNC_CONFIG_DEFAULTS, keep_local: false},
    lastSync: '2026-01-01T00:00:00.000Z',
  }
  await mkdir(join(root, '.claude/rules'), {recursive: true})
  await writeFile(join(root, trackedPath), 'before')
  await writeProjectConfig(root, config)
  const legacy =
    JSON.stringify(
      {lastSync: config.lastSync, files: {[trackedPath]: {hash: hashContent('before'), sourceName: 'team'}}},
      null,
      4,
    ) + '\n'
  await writeFile(join(root, '.crucible/sync-state.json'), legacy)
  return {config, legacy, context: {projectRoot: root, projectConfig: config, hasProjectConfig: true}}
}

export async function protectedBytes(root: string) {
  const result: Record<string, Awaited<ReturnType<typeof snapshot>>> = {}
  for (const path of ['.claude', '.crucible'])
    if (existsSync(join(root, path))) result[path] = await snapshot(join(root, path))
  return result
}
export async function handlerFixture(root: string) {
  const {context, legacy} = await syncFixture(root)
  const reports: SyncReport[] = []
  return {
    context,
    legacy,
    reports,
    dependencies: {
      io: {resolveProjectRoot: () => root, buildContext: async () => context},
      loadSource: async () => [{relativePath: 'rules/a.md', content: 'after'}],
      reports: {
        writeReport: async (report: SyncReport) => {
          reports.push(report)
        },
        rotate: async () => {},
        readLatest: async () => null,
        readHistory: async () => [],
        getReportDir: () => root,
      },
    },
  }
}
