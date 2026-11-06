import {join, resolve} from 'node:path'

import {gitFixtures} from '@e2e/fixtures/git-manifest'

import {runPipe} from './pipe'

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
    throw new Error(`Fixture command failed: ${command.join(' ')}\n${result.stderr}`)
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
