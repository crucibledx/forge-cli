import {mkdir, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import type {ProjectConfig} from '@domain/config/types'
import {SYNC_CONFIG_DEFAULTS} from '@domain/config/types'
import {hashContent} from '@domain/sync/state'
import {writeProjectConfig} from '@infrastructure/config/writer'

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
