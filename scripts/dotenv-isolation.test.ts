import {cpSync, readFileSync, symlinkSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {expect, it} from 'bun:test'

import {repositoryRoot} from './repository-root'
import {testEnvironment} from './test-sandbox'

const dir = useTmpDir('dotenv-isolation')
const keys = ['FORGE_SECRET', 'SSH_AUTH_SOCK', 'GITHUB_TOKEN']
const cases = ['.env', '.env.test'].flatMap((file) =>
  ['launcher', 'bun', 'absolute-bun', 'nested-run'].map((mode) => ({file, mode})),
)
it.each(cases)('AC-14,19,25,27 $mode refuses $file before imports and nested Bun scripts', ({file, mode}) => {
  const checkout = join(dir(), 'checkout')
  for (const folder of ['scripts', 'src', 'e2e'])
    cpSync(join(repositoryRoot, folder), join(checkout, folder), {recursive: true})
  for (const name of ['package.json', 'tsconfig.json', '.bun-version', 'bun.lock'])
    cpSync(join(repositoryRoot, name), join(checkout, name))
  symlinkSync(join(repositoryRoot, 'node_modules'), join(checkout, 'node_modules'), 'junction')
  writeFileSync(join(checkout, file), keys.map((key) => `${key}=SYNTHETIC_DOTENV_ONLY`).join('\n'))
  const env: Record<string, string> = {...testEnvironment(dir()), NODE_ENV: 'test'}
  // The fixture driver is protected explicitly. Descendants must establish their
  // own protection rather than accidentally inheriting it from this test runner.
  delete env.BUN_OPTIONS
  const observe = `Object.fromEntries(${JSON.stringify(keys)}.map(key => [key, process.env[key] !== undefined]))`
  const control = Bun.spawnSync([process.execPath, '-e', `console.log(JSON.stringify(${observe}))`], {
    cwd: checkout,
    env,
    timeout: 10000,
  })
  expect(control.exitCode).toBe(0)
  expect(JSON.parse(control.stdout.toString())).toEqual(Object.fromEntries(keys.map((key) => [key, true])))
  const observation = join(checkout, 'observed.json')
  const probe = `import {writeFileSync} from 'node:fs'
const observed = ${observe}
writeFileSync(${JSON.stringify(observation)}, JSON.stringify(observed))
if (Object.values(observed).some(Boolean)) throw new Error('Synthetic dotenv credentials reached an import')
`
  const preload = join(checkout, 'scripts/test-preload.ts')
  writeFileSync(preload, readFileSync(preload, 'utf8') + '\n' + probe)
  writeFileSync(join(checkout, 'probe.ts'), probe)
  writeFileSync(
    join(checkout, 'probe.test.ts'),
    "import './probe'; import {it} from 'bun:test'; it('isolated', () => {})\n",
  )
  const pkg = JSON.parse(readFileSync(join(checkout, 'package.json'), 'utf8'))
  pkg.scripts['dotenv-probe'] = 'bun ./probe.ts'
  writeFileSync(join(checkout, 'package.json'), JSON.stringify(pkg))
  const command = [
    mode === 'absolute-bun' ? process.execPath : 'bun',
    'run',
    mode === 'nested-run' ? 'dotenv-probe' : './probe.ts',
  ]
  const driver =
    mode === 'launcher'
      ? `import {runTests} from './scripts/run-tests'; process.exitCode = await runTests(['--','probe.test.ts'])`
      : `import {executeCheck} from './scripts/validation-process'
const result = await executeCheck(${JSON.stringify(command)}, 10000)
console.log(JSON.stringify(result))
process.exitCode = result.exit_code ?? 2`
  const result = Bun.spawnSync([process.execPath, '--no-env-file', '-e', driver], {
    cwd: checkout,
    env,
    timeout: 35000,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  expect(result.exitCode).toBe(0)
  expect(JSON.parse(readFileSync(observation, 'utf8'))).toEqual(Object.fromEntries(keys.map((key) => [key, false])))
})
