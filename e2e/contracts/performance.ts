import {readFile} from 'node:fs/promises'
import {join, resolve} from 'node:path'

import {hashContent} from '@domain/sync/state'
import {runPipe} from '@e2e/framework/pipe'

export const performanceBaseline = 'insufficient, advisory only'
export async function performancePhase(
  root: string,
  phase: 'cold-help' | 'cold-sync' | 'warm-sync',
  skills: Record<string, string>,
  run = runPipe,
): Promise<number> {
  const start = performance.now()
  const result = await run(
    root,
    [
      process.execPath,
      resolve(import.meta.dir, '../../src/main.ts'),
      ...(phase === 'cold-help' ? ['--help'] : ['sync']),
    ],
    {timeoutMs: 30000},
  )
  if (result.timedOut) throw new Error('Performance invocation exceeded its 30-second deadline')
  if (result.exitCode !== 0 || result.stderr) throw new Error('Performance invocation failed')
  if (phase === 'cold-help') {
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
