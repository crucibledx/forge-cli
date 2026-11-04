import {useTmpDir} from '@test-helpers/tmp'
import {it} from 'bun:test'

import {setupLocalSync} from '@e2e/fixtures'

import {performanceBaseline, performancePhase} from './performance'

const dir = useTmpDir('performance')
it.each([10, 1000])(
  'offline %s-target cold help/cold sync/warm sync correctness, advisory timing (AC-31)',
  async (count) => {
    const skills = Object.fromEntries(Array.from({length: count}, (_, i) => [`fixture-${i}.md`, `# Fixture ${i}\n`]))
    await setupLocalSync(dir(), ['claude-code'], {skills})
    const samples: Record<string, number> = {}
    for (const phase of ['cold-help', 'cold-sync', 'warm-sync'] as const)
      samples[phase] = await performancePhase(dir(), phase, skills)
    console.log(
      JSON.stringify({
        fixture_targets: count,
        os: process.platform,
        bun: Bun.version,
        timings_ms: samples,
        baseline: performanceBaseline,
      }),
    )
  },
  40000,
)
