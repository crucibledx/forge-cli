import {readFileSync, statSync} from 'node:fs'
import {resolve} from 'node:path'

import {type TestSuite, testSuites} from './registry/suites'
import {createTestSandbox} from './test-sandbox'
import {repositoryRoot} from './validation-identity'

export async function runTests(args: string[]): Promise<number> {
  let timeout = '20000'
  if (args[0] === '--timeout-ms') {
    timeout = args[1]
    args = args.slice(2)
  }
  // `bun run file.ts -- ...` consumes the separator; direct execution retains it.
  if (args[0] === '--') args = args.slice(1)
  if (args[0] === '--suite') {
    if (args.length !== 2 || !Object.hasOwn(testSuites, args[1])) throw new Error('Unknown or malformed test suite')
    args = [...testSuites[args[1] as TestSuite]]
  }
  if (!['20000', '40000'].includes(timeout) || !args.length || args.some((arg) => arg.startsWith('-'))) {
    throw new Error('Usage: run-tests.ts [--timeout-ms 20000|40000] -- <paths...>')
  }
  const pin = readFileSync(resolve(repositoryRoot, '.bun-version'), 'utf8').trim()
  if (Bun.version !== pin) throw new Error(`Tests require Bun ${pin}; found ${Bun.version}`)
  const sandbox = createTestSandbox()
  try {
    const files = [
      ...new Set(
        args.flatMap((path) => {
          const full = resolve(repositoryRoot, path)
          return statSync(full).isDirectory()
            ? [...new Bun.Glob('**/*.{test,spec}.{ts,tsx,js,jsx,mjs,cjs}').scanSync({cwd: full, absolute: true})]
            : [full]
        }),
      ),
    ].sort()
    if (!files.length) throw new Error('No test files matched the selected paths')
    // Bun module mocks mutate cached exports across files, even after restore().
    // Keep mock-heavy legacy files serial in fresh processes, not reordered to
    // conceal pollution. The unmocked safety suite always uses real modules.
    const mocked = files.filter((path) => /\bmock\.module\s*\(/.test(readFileSync(path, 'utf8')))
    const clean = files.filter((path) => !mocked.includes(path))
    const batches = [...(clean.length ? [clean] : []), ...mocked.map((file) => [file])]
    let failed = false
    for (const batch of batches) {
      const child = Bun.spawn(
        [
          process.execPath,
          'test',
          '--preload',
          resolve(import.meta.dir, 'test-preload.ts'),
          '--timeout',
          timeout,
          ...batch,
        ],
        {
          cwd: repositoryRoot,
          env: sandbox.env,
          stdin: 'ignore',
          stdout: 'inherit',
          stderr: 'inherit',
        },
      )
      if ((await child.exited) !== 0) failed = true
    }
    return failed ? 1 : 0
  } finally {
    sandbox.dispose()
  }
}

if (import.meta.main) {
  try {
    process.exitCode = await runTests(Bun.argv.slice(2))
  } catch (error) {
    console.error((error as Error).message)
    process.exitCode = 2
  }
}
