import {mkdir, readFile} from 'node:fs/promises'
import {join} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {describe, expect, it} from 'bun:test'

import {getSyncStatePath, loadSyncState, writeSyncState} from './state'

const getDir = useTmpDir('sync_state')

describe('getSyncStatePath', () => {
  it('returns path inside .crucible dir', () => {
    expect(getSyncStatePath('/my/project')).toBe('/my/project/.crucible/sync-state.json')
  })
})

describe('loadSyncState', () => {
  it('returns empty state when file does not exist', async () => {
    const state = await loadSyncState(getDir())
    expect(state.lastSync).toBe('')
    expect(Object.keys(state.files)).toHaveLength(0)
  })

  it('parses state from existing file', async () => {
    const dir = getDir()
    const stateDir = join(dir, '.crucible')
    await mkdir(stateDir, {recursive: true})

    const state = {
      lastSync: '2026-05-21T12:00:00.000Z',
      files: {
        '.claude/skills/deploy.md': {hash: 'abc123', sourceName: 'team'},
      },
    }
    await Bun.write(join(stateDir, 'sync-state.json'), JSON.stringify(state))

    const loaded = await loadSyncState(dir)
    expect(loaded.lastSync).toBe('2026-05-21T12:00:00.000Z')
    expect(loaded.files['.claude/skills/deploy.md'].hash).toBe('abc123')
    expect(loaded.files['.claude/skills/deploy.md'].sourceName).toBe('team')
  })
})

describe('writeSyncState', () => {
  it('creates .crucible dir and writes state file', async () => {
    const dir = getDir()
    const state = {
      lastSync: '2026-05-21T12:00:00.000Z',
      files: {
        'a.md': {hash: 'abc', sourceName: 'src'},
      },
    }

    await writeSyncState(dir, state)

    const raw = await readFile(join(dir, '.crucible', 'sync-state.json'), 'utf-8')
    const parsed = JSON.parse(raw)
    expect(parsed.lastSync).toBe('2026-05-21T12:00:00.000Z')
    expect(parsed.files['a.md'].hash).toBe('abc')
  })

  it('overwrites existing state file', async () => {
    const dir = getDir()

    await writeSyncState(dir, {lastSync: 'old', files: {old: {hash: 'x', sourceName: 's'}}})
    await writeSyncState(dir, {lastSync: 'new', files: {new: {hash: 'y', sourceName: 's'}}})

    const raw = await readFile(join(dir, '.crucible', 'sync-state.json'), 'utf-8')
    const parsed = JSON.parse(raw)
    expect(parsed.lastSync).toBe('new')
    expect(parsed.files).not.toHaveProperty('old')
    expect(parsed.files['new'].hash).toBe('y')
  })
})
