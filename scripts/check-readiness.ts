import {resolve} from 'node:path'

import {readinessCLI} from './readiness'
import {readinessProvider} from './readiness-provider'
import {repositoryRoot} from './validation-context'

if (import.meta.main) {
  const args = Bun.argv.slice(2),
    index = args.indexOf('--input')
  const input =
    index >= 0 && args[index + 1] ? resolve(args[index + 1]) : resolve(repositoryRoot, 'results/readiness-input.json')
  process.exitCode = await readinessCLI(args, readinessProvider(repositoryRoot, resolve(input, '..')), repositoryRoot)
}
