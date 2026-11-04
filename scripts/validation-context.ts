import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'

import {contextSchema} from './evidence-schema'
import {requiredLaneIds} from './validation-lanes'

export function actualHead(root: string): string {
  const result = Bun.spawnSync(['git', '-C', root, 'rev-parse', 'HEAD'], {stdout: 'pipe', stderr: 'pipe'})
  if (result.exitCode !== 0) throw new Error('Cannot determine immutable tested revision')
  return new TextDecoder().decode(result.stdout).trim()
}
/** Expected identity is from the checkout/event, never an uploaded lane. */
export function validationContext(root: string) {
  const tested = actualHead(root)
  if (process.env.GITHUB_ACTIONS === 'true') {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH!, 'utf8'))
    if (event.repository?.full_name !== process.env.GITHUB_REPOSITORY || tested !== process.env.GITHUB_SHA)
      throw new Error('Checkout/event identity mismatch')
    return contextSchema.parse({
      schema_version: 1,
      kind: event.pull_request ? 'pr' : 'local',
      repository: process.env.GITHUB_REPOSITORY,
      ...(event.pull_request ? {pr_number: event.pull_request.number, base_sha: event.pull_request.base.sha} : {}),
      head_sha: event.pull_request?.head.sha ?? tested,
      tested_sha: tested,
      run_id: process.env.GITHUB_RUN_ID,
      run_attempt: Number(process.env.GITHUB_RUN_ATTEMPT),
      workflow_ref: process.env.GITHUB_WORKFLOW_REF,
      required_lane_ids: requiredLaneIds,
    })
  }
  return contextSchema.parse({
    schema_version: 1,
    kind: 'local',
    repository: 'crucibledx/forge-cli',
    head_sha: tested,
    tested_sha: tested,
    run_id: crypto.randomUUID(),
    run_attempt: 1,
    required_lane_ids: requiredLaneIds,
  })
}
export const repositoryRoot = resolve(import.meta.dir, '..')
