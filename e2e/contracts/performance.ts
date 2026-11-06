import {readFile} from 'node:fs/promises'
import {join} from 'node:path'

import {hashContent} from '@domain/sync/state'
import {CLI_ENTRY} from '@e2e/framework/constants'
import {runPipe} from '@e2e/framework/pipe'

const PERFORMANCE_PHASES = {COLD_HELP: 'cold-help', COLD_SYNC: 'cold-sync', WARM_SYNC: 'warm-sync'} as const
type PerformancePhase = (typeof PERFORMANCE_PHASES)[keyof typeof PERFORMANCE_PHASES]

export const performanceBaseline = 'insufficient, advisory only'
export async function performancePhase(
  root: string,
  phase: PerformancePhase,
  skills: Record<string, string>,
  run = runPipe,
): Promise<number> {
  const start = performance.now()
  const result = await run(
    root,
    [process.execPath, CLI_ENTRY, ...(phase === PERFORMANCE_PHASES.COLD_HELP ? ['--help'] : ['sync'])],
    {timeoutMs: 30000},
  )
  if (result.timedOut) throw new Error('Performance invocation exceeded its 30-second deadline')
  if (result.exitCode !== 0 || result.stderr) throw new Error('Performance invocation failed')
  if (phase === PERFORMANCE_PHASES.COLD_HELP) {
    if (!result.stdout.includes('Usage:')) throw new Error('Incorrect help output')
  } else {
    const state = JSON.parse(await readFile(join(root, '.crucible/sync-state.json'), 'utf8'))
    if (state.version !== 2 || Object.keys(state.files).length !== Object.keys(skills).length)
      throw new Error('Incorrect performance state')
    for (const [name, content] of Object.entries(skills)) {
      const path = `.claude/skills/${name}`,
        entry = state.files[path]
      if (
        (await readFile(join(root, path), 'utf8')) !== content ||
        entry?.hash !== hashContent(content) ||
        entry.baseline !== 'installed'
      )
        throw new Error(`Incorrect performance target/state: ${path}`)
    }
  }
  return performance.now() - start
}
