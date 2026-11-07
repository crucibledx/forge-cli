import {mkdir, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {expect, it} from 'bun:test'

import {hashContent} from '@domain/sync/state'
import type {CLIResult} from '@e2e/framework/spawn'

import {performanceBaseline, performancePhase} from './performance'

const dir = useTmpDir('performance-negative')
const okay: CLIResult = {
  exitCode: 0,
  signal: null,
  timedOut: false,
  stdout: 'Usage: forge',
  stderr: '',
  output: 'Usage: forge',
}
it.each(['timeout', 'wrong-help', 'nonzero', 'stderr'])(
  'performance wrapper fails %s without hiding the 30-second budget (AC-31)',
  async (kind) => {
    const result = {
      ...okay,
      ...(kind === 'timeout'
        ? {timedOut: true}
        : kind === 'wrong-help'
          ? {stdout: 'incorrect help'}
          : kind === 'nonzero'
            ? {exitCode: 1}
            : {stderr: 'error'}),
    }
    await expect(
      performancePhase(dir(), 'cold-help', {}, async (_cwd, _command, options) => {
        expect(options?.timeoutMs).toBe(30000)
        return result
      }),
    ).rejects.toThrow()
    expect(performanceBaseline).toBe('insufficient, advisory only')
  },
)
it.each(['wrong-bytes', 'wrong-hash', 'unknown-baseline', 'wrong-count'])(
  'performance wrapper rejects %s even when the command exits zero (AC-31)',
  async (kind) => {
    await mkdir(join(dir(), '.claude/skills'), {recursive: true})
    await mkdir(join(dir(), '.crucible'))
    await writeFile(join(dir(), '.claude/skills/a.md'), kind === 'wrong-bytes' ? 'wrong' : 'expected')
    const files =
      kind === 'wrong-count'
        ? {}
        : {
            '.claude/skills/a.md': {
              hash: hashContent(kind === 'wrong-hash' ? 'wrong' : 'expected'),
              baseline: kind === 'unknown-baseline' ? 'legacy-unknown' : 'installed',
            },
          }
    await writeFile(join(dir(), '.crucible/sync-state.json'), JSON.stringify({version: 2, files}))
    await expect(performancePhase(dir(), 'warm-sync', {'a.md': 'expected'}, async () => okay)).rejects.toThrow(
      'Incorrect performance',
    )
  },
)
