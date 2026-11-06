import {resolve} from 'node:path'

import pkg from '../package.json'
import {repositoryRoot} from './validation-identity'
import {executeCheck} from './validation-process'

if (import.meta.main) {
  let failed = false
  for (const flag of ['--help', '--version']) {
    const result = await executeCheck(
      [resolve(repositoryRoot, process.platform === 'win32' ? 'dist/forge.exe' : 'dist/forge'), flag],
      repositoryRoot,
      30000,
    )
    const correct =
      !result.timed_out &&
      result.exit_code === 0 &&
      !result.stderr &&
      (flag === '--help' ? result.stdout.includes('Usage:') : result.stdout.trim() === pkg.version)
    console.log(JSON.stringify({command: `compiled forge ${flag}`, ...result, correct}))
    if (!correct) failed = true
  }
  process.exitCode = failed ? 1 : 0
}
