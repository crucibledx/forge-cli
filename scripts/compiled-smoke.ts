import {resolve} from 'node:path'

import {executeCheck} from './validation-process'

if (import.meta.main) {
  const root = resolve(import.meta.dir, '..')
  let failed = false
  for (const flag of ['--help', '--version']) {
    const result = await executeCheck(
      [resolve(root, process.platform === 'win32' ? 'dist/forge.exe' : 'dist/forge'), flag],
      root,
      30000,
    )
    const correct =
      !result.timed_out &&
      result.exit_code === 0 &&
      !result.stderr &&
      (flag === '--help' ? result.stdout.includes('Usage:') : result.stdout.trim() === '0.6.24')
    console.log(JSON.stringify({command: `compiled forge ${flag}`, ...result, correct}))
    if (!correct) failed = true
  }
  process.exitCode = failed ? 1 : 0
}
