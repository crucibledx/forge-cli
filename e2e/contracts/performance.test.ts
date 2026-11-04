import {readFile} from 'node:fs/promises'
import {join, resolve} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {expect, it} from 'bun:test'

import {hashContent} from '@domain/sync/state'
import {setupLocalSync} from '@e2e/fixtures'
import {runPipe} from '@e2e/framework/pipe'

const dir = useTmpDir('performance')
const cli = resolve(import.meta.dir, '../../src/main.ts')
it.each([10, 1000])(
  'offline %s-target cold help/cold sync/warm sync correctness, advisory timing (AC-31)',
  async (count) => {
    const skills = Object.fromEntries(Array.from({length: count}, (_, i) => [`fixture-${i}.md`, `# Fixture ${i}\n`]))
    await setupLocalSync(dir(), ['claude-code'], {skills})
    const samples: Record<string, number> = {}
    for (const [phase, args] of [
      ['cold-help', ['--help']],
      ['cold-sync', ['sync']],
      ['warm-sync', ['sync']],
    ] as const) {
      const start = performance.now()
      const result = await runPipe(dir(), [process.execPath, cli, ...args], {timeoutMs: 30000})
      samples[phase] = performance.now() - start
      expect(result.timedOut).toBe(false)
      expect(result.exitCode).toBe(0)
      expect(result.stderr).toBe('')
      if (phase === 'cold-help') expect(result.stdout).toContain('Usage:')
      else {
        const state = JSON.parse(await readFile(join(dir(), '.crucible/sync-state.json'), 'utf8'))
        expect(state.version).toBe(2)
        expect(Object.keys(state.files)).toHaveLength(count)
        for (const [name, content] of Object.entries(skills)) {
          const path = `.claude/skills/${name}`
          expect(await readFile(join(dir(), path), 'utf8')).toBe(content)
          expect(state.files[path]).toMatchObject({hash: hashContent(content), baseline: 'installed'})
        }
      }
    }
    console.log(
      JSON.stringify({
        fixture_targets: count,
        os: process.platform,
        bun: Bun.version,
        timings_ms: samples,
        baseline: 'insufficient, advisory only',
      }),
    )
  },
  40000,
)
