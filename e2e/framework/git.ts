import {join, resolve} from 'node:path'

import {gitFixtures} from '@e2e/fixtures/git-manifest'

import {sessionFailure} from './failure'
import {runPipe} from './pipe'
import {SESSION_MS} from './process'

const history = resolve(import.meta.dir, '../fixtures/git-history.bundle')
function fixtureFor(files: Record<string, string>): string {
  const fixture = gitFixtures.find(
    ([, known]) =>
      Object.keys(files).length === Object.keys(known).length &&
      Object.entries(known).every(([path, content]) => files[path] === content),
  )
  if (!fixture)
    throw new Error(
      'Unknown Git fixture. Extend e2e/fixtures/git-manifest.ts and rebuild frozen history using your configured Git identity.',
    )
  return fixture[0]
}
async function exec(cwd: string, command: string[]): Promise<void> {
  const result = await runPipe(cwd, command)
  if (result.exitCode !== 0 || result.timedOut)
    throw sessionFailure(
      [new Error('Fixture command failed')],
      {
        command,
        cwd,
        exit: result.exitCode,
        signal: result.signal,
        timedOut: result.timedOut,
        timeoutMs: SESSION_MS,
        seed: process.env.FC_SEED ?? null,
        replay: process.env.FC_PATH ?? null,
      },
      `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    )
}

/** Import existing local fixture commits, never author commits or configure identity in tests. */
export async function createBareRepo(baseDir: string, files: Record<string, string>, branch = 'main'): Promise<string> {
  const path = join(baseDir, 'repo.git')
  const fixture = fixtureFor(files)
  await exec(baseDir, ['git', 'clone', '--bare', '--single-branch', '--branch', fixture, history, path])
  await exec(baseDir, ['git', '-C', path, 'update-ref', `refs/heads/${branch}`, `refs/heads/${fixture}`])
  await exec(baseDir, ['git', '-C', path, 'symbolic-ref', 'HEAD', `refs/heads/${branch}`])
  return path
}
export async function addBranchToBareRepo(
  baseDir: string,
  barePath: string,
  branch: string,
  files: Record<string, string>,
): Promise<void> {
  await exec(baseDir, ['git', '-C', barePath, 'fetch', history, `refs/heads/${fixtureFor(files)}:refs/heads/${branch}`])
}
