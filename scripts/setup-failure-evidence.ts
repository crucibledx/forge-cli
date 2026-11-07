// No third-party imports: this must run after frozen dependency installation fails.
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'

import {writeEvidence} from './evidence-io'
import {checkEvidencePath} from './validation-evidence'
import {rawValidationContext, repositoryRoot} from './validation-identity'
import {laneById} from './validation-lanes'

if (import.meta.main) {
  const args = Bun.argv.slice(2)
  if (args.length !== 2 || args[0] !== '--lane') throw new Error('Expected --lane <id>')
  const lane = laneById(args[1])
  const context = rawValidationContext()
  const directory = join(repositoryRoot, 'results')
  const reason = 'Toolchain/dependency installation failed; dependent check was not executed'
  const checks = []
  for (const check of lane.checks) {
    const ref = checkEvidencePath(lane.id, check.id)
    await writeEvidence(join(directory, ref), {command: check.command, exit_code: null, reason}, repositoryRoot, {
      exclusive: true,
    })
    checks.push({
      id: check.id,
      command: check.command.join(' '),
      exit_code: null,
      duration_ms: 0,
      evidence: [ref],
      reason,
    })
  }
  await writeEvidence(join(directory, 'context.json'), context, repositoryRoot, {exclusive: true})
  await writeEvidence(
    join(directory, `${lane.id}.json`),
    {
      schema_version: 1,
      head_sha: context.head_sha,
      tested_sha: context.tested_sha,
      run_id: context.run_id,
      run_attempt: context.run_attempt,
      lane_id: lane.id,
      status: 'blocked',
      runner_os: process.platform,
      bun_version: Bun.version,
      duration_ms: 0,
      checks,
    },
    repositoryRoot,
    {exclusive: true},
  )
  console.error(
    `Installation failed with pinned Bun${(await readFile(join(repositoryRoot, '.bun-version'), 'utf8')).trim()}; ${lane.id} checks blocked`,
  )
}
