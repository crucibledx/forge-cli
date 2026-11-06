import {dirname} from 'node:path'

import {readinessCLI, readinessInputPath} from './readiness'
import {readinessProvider} from './readiness-provider'
import {repositoryRoot} from './validation-context'

if (import.meta.main) {
  const args = Bun.argv.slice(2)
  const input = readinessInputPath(args, repositoryRoot)
  process.exitCode = await readinessCLI(args, readinessProvider(dirname(input)), repositoryRoot)
}
