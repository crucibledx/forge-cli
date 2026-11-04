import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {snapshot} from '@test-helpers/snapshot'
import {useTmpDir} from '@test-helpers/tmp'
import {afterEach, describe, expect, it} from 'bun:test'

import {assistantsRegistry, getAllAssistants, getAssistant, resolveAssistantByPath} from '@domain/assistants'
import type {Source} from '@domain/config/types'
import {SYNC_CONFIG_DEFAULTS} from '@domain/config/types'
import {setGlobalMode} from '@domain/scope'
import type {SyncState} from '@domain/sync/state'
import {hashContent} from '@domain/sync/state'
import type {ResolvedTarget} from '@domain/sync/types'

import {buildPlan, fetchAndResolve} from './handler'

const path = '.claude/rules/a.md'
const target = (targetPath = path, content = 'desired'): ResolvedTarget => ({
  targetPath,
  content,
  sourcePath: 'rules/a.md',
  sourceName: 'team',
  assistantId: 'claude-code',
})
const state = (baseline: 'installed' | 'legacy-unknown' = 'installed', content = 'old'): SyncState => ({
  version: 2,
  lastSync: '2026-01-01T00:00:00.000Z',
  files: {[path]: {hash: hashContent(content), sourceName: 'old', baseline}},
})
const defaults = {...SYNC_CONFIG_DEFAULTS, keep_local: false}

describe('BR-01–08 safety planning (AC-2–9)', () => {
  const dir = useTmpDir('plan')
  async function disk(file: string, content: string) {
    await mkdir(join(dir(), file, '..'), {recursive: true})
    await writeFile(join(dir(), file), content)
  }
  afterEach(() => setGlobalMode(false))
  it('collects load and resolution failures plus successes before aborting either source type', async () => {
    const attempted: string[] = []
    const definitions = [
      {
        ...getAssistant('claude-code'),
        targetMappings: [{sourceGlob: 'rules/**', destination: {project: '.claude/rules/'}}],
      },
    ]
    for (const type of ['local', 'git']) {
      attempted.length = 0
      await expect(
        fetchAndResolve(
          [
            {name: 'load-failure', type},
            {name: 'resolve-failure', type, layout: 'invalid-layout' as Source['layout']},
            {name: 'valid', type},
            {name: 'valid-empty', type},
          ],
          definitions,
          async (source) => {
            attempted.push(source.name)
            if (source.name === 'load-failure') throw new Error('source read denied')
            return source.name === 'valid-empty' ? [] : [{relativePath: 'rules/a.md', content: 'desired'}]
          },
        ),
      ).rejects.toThrow('Source acquisition failed')
      expect(attempted).toEqual(['load-failure', 'resolve-failure', 'valid', 'valid-empty'])
    }
    expect(await snapshot(dir())).toEqual({})
  })
  it.each(['local-wins', 'error', 'remote-wins'] as const)(
    'applies %s to legacy desired-hash updates and stale unknown baselines',
    async (strategy) => {
      await disk(path, 'local')
      const before = await snapshot(dir())
      for (const desired of [[target()], []]) {
        const pending = buildPlan(dir(), desired, state('legacy-unknown', 'desired'), {
          ...defaults,
          local_conflict_strategy: strategy,
        })
        if (strategy === 'error') await expect(pending).rejects.toThrow('Local conflict')
        else {
          const plan = await pending
          if (strategy === 'local-wins') expect(plan.summaries[0].status).toBe('skipped')
          else {
            expect(plan.mutations).toContainEqual({type: 'file_write', path: `${path}.bak`, content: 'local'})
            expect(plan.summaries[0].status).toBe(desired.length ? 'update' : 'deleted')
          }
        }
      }
      expect(await snapshot(dir())).toEqual(before)
    },
  )
  it('treats a stale unknown baseline as changed even if old hash matches local bytes', async () => {
    await disk(path, 'local')
    const plan = await buildPlan(dir(), [], state('legacy-unknown', 'local'), {
      ...defaults,
      local_conflict_strategy: 'local-wins',
    })
    expect(plan.summaries[0].status).toBe('skipped')
  })
  it('plans readable empty input cleanup without inventing untracked sibling deletions', async () => {
    await disk(path, 'old')
    await disk('.claude/rules/user.md', 'untracked')
    const plan = await buildPlan(dir(), [], state(), defaults)
    expect(plan.mutations).toEqual([{type: 'file_delete', path}])
    expect(await readFile(join(dir(), '.claude/rules/user.md'), 'utf8')).toBe('untracked')
    expect((await buildPlan(dir(), [], state(), {...defaults, keep_local: true})).mutations).toEqual([])
  })
  it('aborts all valid neighbors when any planning read fails', async () => {
    await mkdir(join(dir(), path), {recursive: true})
    const before = await snapshot(dir())
    await expect(buildPlan(dir(), [target(), target('.claude/rules/neighbor.md')], state(), defaults)).rejects.toThrow(
      'Planning failed',
    )
    expect(await snapshot(dir())).toEqual(before)
  })
  it('preserves explicit untracked overwrite semantics and rejects/reuses backup bytes safely', async () => {
    await disk(path, 'untracked')
    const empty = {lastSync: '', files: {}}
    expect(
      (await buildPlan(dir(), [target()], empty, {...defaults, local_conflict_strategy: 'error'})).mutations,
    ).toHaveLength(2)
    await disk(`${path}.bak`, 'different')
    await expect(buildPlan(dir(), [target()], empty, defaults)).rejects.toThrow('Different backup')
    await disk(`${path}.bak`, 'untracked')
    expect((await buildPlan(dir(), [target()], empty, defaults)).mutations).toEqual([
      {type: 'file_write', path, content: 'desired'},
    ])
  })
  it.each(
    [
      ['.claude/rules/A.md', '.claude/rules/a.md'],
      ['.claude/rules/cafe\u0301.md', '.claude/rules/café.md'],
      ['.claude/rules/a.md', '.claude\\rules\\a.md'],
      ['.claude/rules/a', '.claude/rules/a/child.md'],
      ['.crucible/sync-state.json'],
      ['.crucible/forge.config.yaml'],
    ].map((paths) => ({paths})),
  )('rejects aliases, ancestors and metadata collisions %# before writes', async ({paths}) => {
    await expect(
      buildPlan(
        dir(),
        paths.map((p) => target(p)),
        {files: {}, lastSync: ''},
        defaults,
      ),
    ).rejects.toThrow()
    expect(await snapshot(dir())).toEqual({})
  })
  it('rejects a source target colliding with a generated backup', async () => {
    await disk(path, 'old')
    await expect(buildPlan(dir(), [target(), target(`${path}.bak`)], state(), defaults)).rejects.toThrow('Competing')
  })
  it('classifies every registered assistant in both scopes and retains disabled/unknown/ambiguous stale ownership', async () => {
    for (const global of [false, true]) {
      setGlobalMode(global)
      for (const assistant of getAllAssistants())
        for (const mapping of assistant.targetMappings) {
          const destination = global
            ? (mapping.destination.global ?? mapping.destination.project)
            : mapping.destination.project
          const owned = `${destination.replace(/\/$/, '')}/a.md`
          expect(resolveAssistantByPath(owned.replaceAll('/', '\\'))?.id).toBe(assistant.id)
          const sibling = owned.split('/')
          sibling[0] += '-sibling'
          expect(resolveAssistantByPath(sibling.join('/'))).toBeUndefined()
          const tracked: SyncState = {
            lastSync: '',
            files: {[owned]: {hash: hashContent('old'), sourceName: 'removed-source', baseline: 'installed'}},
          }
          const enabled = new Set([assistant.id])
          expect((await buildPlan(dir(), [], tracked, defaults, enabled)).summaries[0].status).toBe('deleted')
          const disabled = await buildPlan(dir(), [], tracked, defaults, new Set())
          expect(disabled.mutations).toEqual([])
          expect(disabled.warnings).toHaveLength(1)
        }
    }
    setGlobalMode(false)
    assistantsRegistry.push({...getAssistant('claude-code'), id: 'ambiguous-test'})
    try {
      expect(resolveAssistantByPath(path)).toBeUndefined()
      const plan = await buildPlan(
        dir(),
        [],
        {...state(), files: {...state().files, 'unknown/file.md': state().files[path]}},
        defaults,
      )
      expect(plan.mutations).toEqual([])
      expect(plan.warnings).toHaveLength(2)
      const ambiguousWrite = await buildPlan(dir(), [target()], state(), defaults, new Set(['claude-code']))
      expect(ambiguousWrite.mutations).toEqual([])
      expect(ambiguousWrite.warnings.length).toBeGreaterThan(0)
    } finally {
      assistantsRegistry.pop()
    }
  })
})
