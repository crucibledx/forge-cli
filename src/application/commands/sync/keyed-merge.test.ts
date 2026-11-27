import {readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {snapshot} from '@test-helpers/snapshot'
import {applySyncPlan, syncFixture, trackedPath} from '@test-helpers/sync-fixture'
import {useTmpDir} from '@test-helpers/tmp'
import {describe, expect, it} from 'bun:test'

import {SYNC_CONFIG_DEFAULTS} from '@domain/config/types'
import {reconcileState} from '@domain/sync/reconcile'
import type {SyncState} from '@domain/sync/state'
import {hashContent, withKeyedEntries} from '@domain/sync/state'
import {loadSyncState} from '@infrastructure/config'
import type {KeyedValue} from '@infrastructure/config/keyed-merge'
import {transactionIO} from '@infrastructure/fs/transaction'

import {commitOwnedKeyRemoval, planOwnedKeyRemoval} from '../shared/keyed.cleanup'
import {SafetyError} from './errors'
import type {KeyedFile} from './handler'
import {buildPlan} from './handler'

const settings = '.claude/settings.local.json'
const userSettings = '{\n  // keep me\n  "model": "opus",\n  "enabledPlugins": {"mine@team": true}\n}\n'
const enabled: KeyedValue = {key: {kind: 'member', path: ['enabledPlugins', 'foo@crucible-forge-x']}, value: true}
const marketplace: KeyedValue = {
  key: {kind: 'member', path: ['extraKnownMarketplaces', 'crucible-forge-x']},
  value: {source: {source: 'directory', path: '/cache'}},
}
const keyed = (values: KeyedValue[] = [enabled, marketplace]): KeyedFile[] => [
  {path: settings, sourceName: 'plugin:foo', values},
]
const defaults = {...SYNC_CONFIG_DEFAULTS, keep_local: false}

describe('BR-11 keyed merge in sync planning (0003-AC-11,14,15)', () => {
  const dir = useTmpDir('keyed-merge-sync')

  async function install(root: string, values?: KeyedValue[]) {
    const {context} = await syncFixture(root)
    await writeFile(join(root, settings), userSettings)
    const state = await loadSyncState(root)
    const plan = await buildPlan(root, [], state, defaults, undefined, {keyed: keyed(values)})
    const next = withKeyedEntries(reconcileState(state, [], plan.summaries, new Date().toISOString()), plan.keyed)
    await applySyncPlan(root, plan.mutations, next, context)
    return {context, next}
  }

  it('0003-AC-11 plans a keyed merge, persists ownedKeys in state v3 and is idempotent', async () => {
    const {next} = await install(dir())
    const text = await readFile(join(dir(), settings), 'utf8')
    expect(text).toContain('// keep me')
    expect(text).toContain('"mine@team": true')
    const saved = JSON.parse(await readFile(join(dir(), '.crucible/sync-state.json'), 'utf8'))
    expect(saved.version).toBe(3)
    expect(Object.keys(saved.files[settings].ownedKeys)).toEqual([
      'enabledPlugins["foo@crucible-forge-x"]',
      'extraKnownMarketplaces.crucible-forge-x',
    ])
    const again = await buildPlan(dir(), [], next, defaults, undefined, {keyed: keyed()})
    expect(again.mutations).toEqual([])
    expect(again.keyed[settings]).toEqual(next.files[settings])
  })

  it('0003-AC-11 blocks drift without --force; --force overwrites, backs up and lists it', async () => {
    const {next} = await install(dir())
    const edited = (await readFile(join(dir(), settings), 'utf8')).replace(
      '"foo@crucible-forge-x": true',
      '"foo@crucible-forge-x": false',
    )
    await writeFile(join(dir(), settings), edited)
    const blocked = buildPlan(dir(), [], next, defaults, undefined, {keyed: keyed()})
    await expect(blocked).rejects.toBeInstanceOf(SafetyError)
    await expect(blocked).rejects.toThrow(`${settings}: Forge-owned keys were changed outside forge`)
    const forced = await buildPlan(dir(), [], next, defaults, undefined, {keyed: keyed(), force: true})
    expect(forced.overridden).toEqual([`${settings} enabledPlugins["foo@crucible-forge-x"]`])
    expect(forced.mutations.map((mutation) => [mutation.type, mutation.path])).toEqual([
      ['file_write', `${settings}.bak`],
      ['keyed_merge', settings],
    ])
  })

  it('0003-AC-11 blocks an unparseable settings file with a named error', async () => {
    await syncFixture(dir())
    await writeFile(join(dir(), settings), '{"model": ')
    await expect(
      buildPlan(dir(), [], await loadSyncState(dir()), defaults, undefined, {keyed: keyed()}),
    ).rejects.toThrow(`${settings}: Unparseable settings file`)
  })

  it('--force overrides a local conflict strategy of error for file drift and lists the file', async () => {
    await syncFixture(dir())
    await writeFile(join(dir(), trackedPath), 'local edit')
    const state: SyncState = {
      lastSync: '',
      files: {[trackedPath]: {hash: hashContent('before'), sourceName: 'team', baseline: 'installed'}},
    }
    const target = {
      targetPath: trackedPath,
      sourcePath: 'rules/a.md',
      sourceName: 'team',
      harnessId: 'claude-code',
      content: 'after',
    }
    const strict = {...defaults, local_conflict_strategy: 'error' as const}
    await expect(buildPlan(dir(), [target], state, strict)).rejects.toThrow('Local conflict')
    const forced = await buildPlan(dir(), [target], state, strict, undefined, {force: true})
    expect(forced.overridden).toEqual([trackedPath])
    expect(forced.summaries[0].status).toBe('update')
  })

  it('removes keys forge no longer declares, never the shared file, even with keep_local', async () => {
    const {context, next} = await install(dir())
    const plan = await buildPlan(dir(), [], next, {...defaults, keep_local: true}, undefined, {keyed: []})
    expect(plan.mutations.map((mutation) => mutation.type)).toEqual(['keyed_merge'])
    expect(plan.keyed).toEqual({[settings]: null})
    await applySyncPlan(dir(), plan.mutations, withKeyedEntries(next, plan.keyed), context)
    const text = await readFile(join(dir(), settings), 'utf8')
    expect(text).toContain('// keep me')
    expect(text).not.toContain('crucible-forge-x')
    expect((await loadSyncState(dir())).files[settings]).toBeUndefined()
  })

  it('BR-02 retains owned keys of a disabled harness instead of removing them', async () => {
    const {next} = await install(dir())
    const plan = await buildPlan(dir(), [], next, defaults, new Set<string>(), {keyed: []})
    expect(plan.mutations).toEqual([])
    expect(plan.keyed).toEqual({[settings]: next.files[settings]})
    expect(plan.warnings).toEqual([`Retaining tracked path with disabled, unknown or ambiguous ownership: ${settings}`])
  })

  it('0003-AC-14 rolls back the whole keyed-merged settings file and v2 state when a later write fails', async () => {
    const {context} = await syncFixture(dir())
    await writeFile(join(dir(), settings), userSettings)
    const before = await snapshot(dir())
    const state = await loadSyncState(dir())
    const plan = await buildPlan(dir(), [], state, defaults, undefined, {keyed: keyed()})
    const next = withKeyedEntries(reconcileState(state, [], plan.summaries, new Date().toISOString()), plan.keyed)
    let failed = false
    const fs = {
      ...transactionIO,
      replace: async (...args: Parameters<typeof transactionIO.replace>) => {
        await transactionIO.replace(...args)
        if (!failed && args[1].endsWith('forge.config.yaml')) {
          failed = true
          throw new Error('config commit failed')
        }
      },
    }
    await expect(applySyncPlan(dir(), plan.mutations, next, context, fs)).rejects.toThrow('Rollback complete')
    expect(await snapshot(dir())).toEqual(before)
  })

  it('0003-AC-14 refuses a settings file changed between planning and commit', async () => {
    const {context} = await syncFixture(dir())
    await writeFile(join(dir(), settings), userSettings)
    const state = await loadSyncState(dir())
    const plan = await buildPlan(dir(), [], state, defaults, undefined, {keyed: keyed()})
    await writeFile(join(dir(), settings), userSettings.replace('opus', 'sonnet'))
    const before = await snapshot(dir())
    await expect(applySyncPlan(dir(), plan.mutations, state, context)).rejects.toThrow('Changed since planning')
    expect(await snapshot(dir())).toEqual(before)
  })

  it('0003-AC-15 upgrades legacy/v2 state to v3 only in the committed transaction', async () => {
    const {context, legacy} = await syncFixture(dir())
    const state = await loadSyncState(dir())
    expect(state.version).toBe(3)
    expect(Object.values(state.files).every((entry) => entry.ownedKeys === undefined)).toBe(true)
    expect(await readFile(join(dir(), '.crucible/sync-state.json'), 'utf8')).toBe(legacy)
    await applySyncPlan(dir(), [], state, context)
    expect(JSON.parse(await readFile(join(dir(), '.crucible/sync-state.json'), 'utf8')).version).toBe(3)
  })

  it('0003-AC-13 uninstall removal deletes only owned keys and keeps keys changed outside forge', async () => {
    const {next} = await install(dir())
    expect(await planOwnedKeyRemoval(dir(), {...next, files: {}})).toEqual({operations: [], kept: []})
    const edited = (await readFile(join(dir(), settings), 'utf8')).replace(
      '"foo@crucible-forge-x": true',
      '"foo@crucible-forge-x": false',
    )
    await writeFile(join(dir(), settings), edited)
    const removal = await planOwnedKeyRemoval(dir(), next)
    expect(removal.kept).toEqual([`${settings} enabledPlugins["foo@crucible-forge-x"]`])
    expect(await commitOwnedKeyRemoval(dir(), removal)).toBe(1)
    const text = await readFile(join(dir(), settings), 'utf8')
    expect(text).toContain('// keep me')
    expect(text).toContain('"foo@crucible-forge-x": false')
    expect(text).not.toContain('"crucible-forge-x": {')
    await writeFile(join(dir(), settings), '{')
    await expect(planOwnedKeyRemoval(dir(), next)).rejects.toThrow(`${settings}: Unparseable settings file`)
  })
})
