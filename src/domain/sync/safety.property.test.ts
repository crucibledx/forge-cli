import {createHash} from 'node:crypto'

import {describe, expect, it} from 'bun:test'
import fc from 'fast-check'

import {getAllAssistants} from '@domain/assistants'
import {setGlobalMode} from '@domain/scope'

import {detectLocalConflict} from './conflict'
import {resolveSourceConflicts} from './merge'
import {propertyOptions} from './property-options'
import {reconcileState} from './reconcile'
import {resolveTargets} from './resolver'
import type {SyncState} from './state'
import type {ResolvedTarget, SyncFileSummary} from './types'

const options = propertyOptions(process.env)
const hash = (text: string) => createHash('sha256').update(text).digest('hex')
const target = (id: number, content: string): ResolvedTarget => ({
  targetPath: `rules/${id}.md`,
  content,
  sourcePath: '',
  sourceName: 'team',
  assistantId: 'claude-code',
})

describe('BR-02–04 independent business-rule oracles (AC-20)', () => {
  it('ordered-map oracle: exact-path precedence', () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.integer({min: 0, max: 12}), fc.string()), {maxLength: 50}),
        fc.constantFrom('first-wins' as const, 'last-wins' as const),
        (items, strategy) => {
          const input = items.map(([id, content]) => target(id, content))
          const expected = new Map<string, ResolvedTarget>()
          for (const item of input)
            if (strategy === 'last-wins' || !expected.has(item.targetPath)) expected.set(item.targetPath, item)
          expect(resolveSourceConflicts(input, strategy)).toEqual([...expected.values()])
        },
      ),
      options,
    )
  })
  it('truth-table oracle: installed and unknown conflicts', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('a', 'b', 'c'),
        fc.constantFrom('a', 'b', 'c'),
        fc.constantFrom('a', 'b', 'c'),
        fc.boolean(),
        fc.boolean(),
        (local, stored, remote, installed, tracked) => {
          const state: SyncState = {
            lastSync: '',
            files: tracked
              ? {'a.md': {hash: hash(stored), sourceName: 'old', baseline: installed ? 'installed' : 'legacy-unknown'}}
              : {},
          }
          const expected = tracked && local !== remote && (!installed || (local !== stored && remote !== stored))
          expect(detectLocalConflict('a.md', local, remote, state) !== null).toBe(expected)
        },
      ),
      options,
    )
  })
  it('independent set oracle: noncolliding source resolution stays unique and confined', () => {
    fc.assert(
      fc.property(fc.uniqueArray(fc.integer({min: 0, max: 10000}), {maxLength: 30}), fc.boolean(), (ids, global) => {
        setGlobalMode(global)
        try {
          const input = ids.map((id) => ({relativePath: `skills/file-${id}.md`, content: `content-${id}`}))
          const result = resolveTargets(input, getAllAssistants(), 'team', 'canonical')
          const expected = getAllAssistants().flatMap((assistant) =>
            assistant.targetMappings
              .filter((mapping) => mapping.sourceGlob === 'skills/**')
              .flatMap((mapping) =>
                ids.map((id) => ({
                  assistantId: assistant.id,
                  path: `${(global ? (mapping.destination.global ?? mapping.destination.project) : mapping.destination.project).replace(/\/$/, '')}/file-${id}.md`,
                  content: `content-${id}`,
                })),
              ),
          )
          expect(
            result.map((item) => ({
              assistantId: item.assistantId,
              path: item.targetPath.replaceAll('\\', '/'),
              content: item.content,
            })),
          ).toEqual(expected)
          const folded = result.map((item) => item.targetPath.replaceAll('\\', '/').normalize('NFC').toLowerCase())
          expect(new Set(folded).size).toBe(result.length)
          expect(folded.every((path) => !path.startsWith('/') && !path.split('/').includes('..'))).toBe(true)
        } finally {
          setGlobalMode(false)
        }
      }),
      options,
    )
  })
  it('retention oracle: skipped/retained/deleted/installed reconciliation', () => {
    const entry = fc.record({
      id: fc.integer({min: 0, max: 40}),
      tracked: fc.boolean(),
      installed: fc.boolean(),
      status: fc.constantFrom(
        'new' as const,
        'update' as const,
        'no_change' as const,
        'skipped' as const,
        'deleted' as const,
        'retained' as const,
      ),
      content: fc.string(),
    })
    fc.assert(
      fc.property(fc.uniqueArray(entry, {selector: (item) => item.id, maxLength: 30}), (items) => {
        const previous: SyncState = {version: 2, lastSync: 'before', files: {}}
        const expected: SyncState['files'] = {}
        const targets: ResolvedTarget[] = []
        const summaries: SyncFileSummary[] = []
        for (const item of items) {
          const path = `rules/${item.id}.md`
          if (item.tracked) {
            previous.files[path] = {
              hash: hash('before'),
              sourceName: 'old',
              baseline: item.installed ? 'installed' : 'legacy-unknown',
            }
            expected[path] = {...previous.files[path]}
          }
          if (item.status !== 'deleted' && item.status !== 'retained') targets.push(target(item.id, item.content))
          if (item.status !== 'retained')
            summaries.push({targetPath: path, sourcePath: '', assistantId: 'claude-code', status: item.status})
          if (item.status === 'deleted') delete expected[path]
          else if (item.status !== 'retained' && item.status !== 'skipped')
            expected[path] = {hash: hash(item.content), sourceName: 'team', baseline: 'installed'}
        }
        const original = structuredClone(previous)
        expect(reconcileState(previous, targets, summaries, 'after')).toEqual({
          version: 2,
          lastSync: 'after',
          files: expected,
        })
        expect(previous).toEqual(original)
      }),
      options,
    )
  })
  it('rejects malformed replay controls and accepts an empty fresh-run path', () => {
    for (const seed of ['', 'NaN', '1.2', '0x10', '2147483648'])
      expect(() => propertyOptions({FC_SEED: seed})).toThrow('FC_SEED')
    for (const path of ['x', ':1', '1::2', '../file']) expect(() => propertyOptions({FC_PATH: path})).toThrow('FC_PATH')
    expect(propertyOptions({FC_PATH: ''})).toEqual({numRuns: 100, seed: 20261104})
  })
  it('negative control shrinks a seeded precedence defect and replays its counterexample', () => {
    const property = fc.property(fc.array(fc.integer({min: 0, max: 10}), {minLength: 2, maxLength: 8}), (items) => {
      const intentionallyWrongFirstWins = items[0]
      const independentLastWins = items.at(-1)
      return intentionallyWrongFirstWins === independentLastWins
    })
    const failure = fc.check(property, {numRuns: 100, seed: 20261104})
    expect(failure.failed).toBe(true)
    expect(failure.counterexample?.[0]).toHaveLength(2)
    expect(failure.counterexamplePath).toBeTruthy()
    const replay = fc.check(property, {numRuns: 100, seed: failure.seed, path: failure.counterexamplePath!})
    expect(replay.failed).toBe(true)
    expect(replay.counterexample).toEqual(failure.counterexample)
  })
})
