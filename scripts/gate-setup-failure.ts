// Run directly with pinned Bun, without Zod or any installed packages.
import {lstat, mkdir, realpath, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {blockedGateSummary} from './gate-summary'
import {rawValidationContext, repositoryRoot} from './validation-identity'

if (import.meta.main) {
  try {
    let context = null
    try {
      context = rawValidationContext()
    } catch {
      // Unavailable identity must not be invented even for a blocked summary.
    }
    const summary = blockedGateSummary(
      'Toolchain/dependency installation failed; provider evidence not authenticated',
      context,
    )
    const directory = join(await realpath(repositoryRoot), 'results')
    await mkdir(directory, {recursive: true, mode: 0o700})
    const info = await lstat(directory)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Unsafe evidence directory')
    await writeFile(join(directory, 'gate-summary.json'), JSON.stringify(summary, null, 2) + '\n', {
      flag: 'wx',
      mode: 0o600,
    })
    for (const lane of summary.lanes) console.error(`${lane.lane_id}: blocked, installation failed`)
  } catch {
    console.error('Blocked gate summary could not be persisted')
  }
  process.exitCode = 1
}
