import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'

import {createTestSandbox} from './test-sandbox'

export async function runTests(args: string[]): Promise<number> {
  let timeout = '20000'
  if (args[0] === '--timeout-ms') {
    timeout = args[1]
    args = args.slice(2)
  }
  // `bun run file.ts -- ...` consumes the separator; direct execution retains it.
  if (args[0] === '--') args = args.slice(1)
  if (!['20000', '40000'].includes(timeout) || !args.length || args.some((arg) => arg.startsWith('-'))) {
    throw new Error('Usage: run-tests.ts [--timeout-ms 20000|40000] -- <paths...>')
  }
  const pin = readFileSync(resolve(import.meta.dir, '../.bun-version'), 'utf8').trim()
  if (Bun.version !== pin) throw new Error(`Tests require Bun ${pin}; found ${Bun.version}`)
  const sandbox = createTestSandbox()
  try {
    const child = Bun.spawn([process.execPath, 'test', '--timeout', timeout, ...args], {
      cwd: resolve(import.meta.dir, '..'),
      env: sandbox.env,
      stdin: 'ignore',
      stdout: 'inherit',
      stderr: 'inherit',
    })
    return await child.exited
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
