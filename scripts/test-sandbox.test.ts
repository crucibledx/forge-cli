import {resolve} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {expect, it} from 'bun:test'

import {runPipe} from '../e2e/framework/pipe'
import {allowlistedEnvironment} from './test-sandbox'

const dir = useTmpDir('compiler-environment')
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
