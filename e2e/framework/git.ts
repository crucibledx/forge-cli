import {join} from 'node:path'

import {writeSourceFile} from '@e2e/fixtures/sources'

import {runPipe} from './pipe'
// ─── Git test utilities ──────────────────────────────────────────────────────

async function exec(cwd: string, cmd: string[]): Promise<void> {
  const result = await runPipe(cwd, cmd)
  if (result.exitCode !== 0 || result.timedOut) {
    throw new Error(`Command failed: ${cmd.join(' ')}\n${result.stderr}`)
  }
}

/**
 * Creates a local bare git repo with the given files, returns the bare repo path.
 * No network access required — useful for testing git source flows.
 */
export async function createBareRepo(baseDir: string, files: Record<string, string>, branch = 'main'): Promise<string> {
  const bareDir = join(baseDir, 'repo.git')
  const workDir = join(baseDir, 'repo-work')

  await exec(baseDir, ['git', 'init', '--bare', bareDir])
  await exec(baseDir, ['git', 'clone', bareDir, workDir])
  await exec(workDir, ['git', 'checkout', '-b', branch])

  for (const [path, content] of Object.entries(files)) {
    await writeSourceFile(workDir, path, content)
  }

  await exec(workDir, ['git', 'add', '-A'])
  await exec(workDir, ['git', 'commit', '-m', 'init'])
  await exec(workDir, ['git', 'push', 'origin', branch])

  return bareDir
}

/**
 * Adds a new branch with different files to an existing bare repo.
 */
export async function addBranchToBareRepo(
  baseDir: string,
  barePath: string,
  branch: string,
  files: Record<string, string>,
): Promise<void> {
  const workDir = join(baseDir, `repo-work-${branch.replace(/\//g, '-')}`)

  await exec(baseDir, ['git', 'clone', barePath, workDir])
  await exec(workDir, ['git', 'checkout', '-b', branch])

  for (const [path, content] of Object.entries(files)) {
    await writeSourceFile(workDir, path, content)
  }

  await exec(workDir, ['git', 'add', '-A'])
  await exec(workDir, ['git', 'commit', '-m', `add ${branch}`])
  await exec(workDir, ['git', 'push', 'origin', branch])
}
