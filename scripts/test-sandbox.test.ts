import {appendFileSync, mkdirSync, realpathSync, symlinkSync} from 'node:fs'
import {dirname, join, resolve} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {expect, it} from 'bun:test'

import {runPipe} from '../e2e/framework/pipe'
import {allowlistedEnvironment, createTestSandbox, testEnvironment} from './test-sandbox'

const dir = useTmpDir('compiler-environment')
it.each(
  (['root', 'project', 'nested'] as const).flatMap((location) => [false, true].map((linked) => ({location, linked}))),
)('AC-19 shared Git discovery boundary rejects enclosing config for %j', ({location, linked}) => {
  const outer = join(dir(), 'enclosing')
  mkdirSync(outer)
  const git = (cwd: string, env: Record<string, string>, ...args: string[]) =>
    Bun.spawnSync(['git', ...args], {cwd, env, stdout: 'pipe', stderr: 'pipe', timeout: 5000})
  expect(git(outer, testEnvironment(dir()), 'init', '--quiet').exitCode).toBe(0)
  appendFileSync(join(outer, '.git/config'), '\n[forge]\n\tsandboxBoundary = enclosing-only\n')
  const base = linked ? join(dir(), 'enclosing-alias') : outer
  if (linked) symlinkSync(outer, base, process.platform === 'win32' ? 'junction' : 'dir')
  const sandbox = createTestSandbox('git-boundary-', base)
  try {
    const nested = join(sandbox.project, 'nested')
    mkdirSync(nested)
    const cwd = {root: sandbox.root, project: sandbox.project, nested}[location]
    const unbounded = {...sandbox.env}
    delete unbounded.GIT_CEILING_DIRECTORIES
    const control = git(cwd, unbounded, 'config', '--local', '--get', 'forge.sandboxBoundary')
    expect(control.exitCode).toBe(0)
    expect(control.stdout.toString().trim()).toBe('enclosing-only')
    for (const env of [sandbox.env, testEnvironment(cwd)]) {
      expect(env.GIT_CEILING_DIRECTORIES).toBe(dirname(realpathSync(sandbox.root)))
      expect(git(cwd, env, 'config', '--local', '--get', 'forge.sandboxBoundary').exitCode).toBe(128)
      expect(git(cwd, env, 'rev-parse', '--is-inside-work-tree').exitCode).toBe(128)
      const repository = join(sandbox.project, 'repository')
      mkdirSync(repository, {recursive: true})
      expect(git(cwd, env, '-C', repository, 'init', '--quiet').exitCode).toBe(0)
      appendFileSync(join(repository, '.git/config'), '\n[forge]\n\tsandboxBoundary = fixture-only\n')
      const selected = git(cwd, env, '-C', repository, 'config', '--local', '--get', 'forge.sandboxBoundary')
      expect(selected.exitCode).toBe(0)
      expect(selected.stdout.toString().trim()).toBe('fixture-only')
      const worktree = git(cwd, env, '-C', repository, 'rev-parse', '--show-toplevel')
      expect(worktree.exitCode).toBe(0)
      expect(realpathSync(worktree.stdout.toString().trim())).toBe(realpathSync(repository))
    }
  } finally {
    sandbox.dispose()
  }
})
it('AC-19 excludes inherited secrets from the earliest compiler environment', () => {
  const previous = process.env.FORGE_COMPILER_SECRET
  const options = process.env.BUN_OPTIONS
  process.env.FORGE_COMPILER_SECRET = 'compiler-sentinel'
  process.env.BUN_OPTIONS = '--preload=OPERATOR_PRELOAD_MUST_NOT_RUN'
  try {
    expect(allowlistedEnvironment()).not.toHaveProperty('FORGE_COMPILER_SECRET')
    expect(allowlistedEnvironment()).not.toHaveProperty('BUN_OPTIONS')
  } finally {
    if (previous === undefined) delete process.env.FORGE_COMPILER_SECRET
    else process.env.FORGE_COMPILER_SECRET = previous
    if (options === undefined) delete process.env.BUN_OPTIONS
    else process.env.BUN_OPTIONS = options
  }
})
it('AC-19 native Windows compiles once in isolation and copies independent per-fixture backends', async () => {
  if (process.platform !== 'win32') return
  const source = `
import {appendFileSync, existsSync, statSync} from 'node:fs'
import {join} from 'node:path'
import {createTestSandbox, testEnvironment} from ${JSON.stringify(resolve(import.meta.dir, 'test-sandbox.ts'))}
const original = Bun.spawnSync, launches = []
Bun.spawnSync = (...args) => {if (args[0][1] === 'build') launches.push(args[1]); return original(...args)}
const first = createTestSandbox('first-', process.cwd())
const second = createTestSandbox('second-', process.cwd())
try {
 const lazy = !existsSync(join(first.root, 'bin/schtasks.exe')) && !existsSync(join(second.root, 'bin/schtasks.exe'))
 const firstEnv = first.env
 const secondEnv = testEnvironment(second.project)
 const executable = join(second.root, 'bin/schtasks.exe'), size = statSync(executable).size
 appendFileSync(join(first.root, 'bin/schtasks.exe'), 'fixture-only')
 const independent = statSync(executable).size === size
 const compile = launches[0]
 const isolated = compile.cwd === first.project && compile.env.HOME === firstEnv.HOME &&
   compile.env.USERPROFILE === firstEnv.HOME && compile.env.TMPDIR === firstEnv.TMPDIR &&
   !['FORGE_COMPILER_SECRET','SSH_AUTH_SOCK'].some(key => key in compile.env) &&
   compile.env.BUN_OPTIONS === '--no-env-file'
 first.dispose()
 const run = args => original([executable, ...args], {cwd: second.project, env: secondEnv, stdout: 'pipe', stderr: 'pipe', timeout: 5000})
 const created = run(['/create','/tn','fixture-job']).exitCode
 const queried = run(['/query','/tn','fixture-job']).exitCode
 console.log(JSON.stringify({builds: launches.length, lazy, isolated, independent, created, queried}))
} finally {first.dispose(); second.dispose()}
`
  const result = await runPipe(dir(), [process.execPath, '-e', source], {
    timeoutMs: 30000,
    env: {FORGE_COMPILER_SECRET: 'compiler-sentinel'},
  })
  expect(result.timedOut).toBe(false)
  expect(result.exitCode).toBe(0)
  expect(JSON.parse(result.stdout)).toEqual({
    builds: 1,
    lazy: true,
    isolated: true,
    independent: true,
    created: 0,
    queried: 0,
  })
}, 40000)
