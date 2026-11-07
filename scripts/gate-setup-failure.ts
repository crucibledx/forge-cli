// Run directly with pinned Bun, without Zod or any installed packages.
import {join} from 'node:path'

import {writeEvidence} from './evidence-io'
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
    await writeEvidence(join(repositoryRoot, 'results/gate-summary.json'), summary, repositoryRoot, {exclusive: true})
    for (const lane of summary.lanes) console.error(`${lane.lane_id}: blocked, installation failed`)
  } catch {
    console.error('Blocked gate summary could not be persisted')
  }
  process.exitCode = 1
}
