import type {EvidenceContext, LaneEvidence} from '../evidence-schema'
import {checkEvidencePath} from '../validation-evidence'
import {requiredLaneIds, validationLanes} from '../validation-lanes'

export function laneFixture(): {context: EvidenceContext; lanes: LaneEvidence[]} {
  const head = 'a'.repeat(40),
    tested = 'b'.repeat(40)
  return {
    context: {
      schema_version: 1,
      kind: 'pr',
      repository: 'crucibledx/forge-cli',
      pr_number: 99,
      head_sha: head,
      tested_sha: tested,
      base_sha: 'c'.repeat(40),
      run_id: '123',
      run_attempt: 1,
      workflow_ref: 'crucibledx/forge-cli/.github/workflows/ci.yml@refs/pull/99/merge',
      required_lane_ids: requiredLaneIds,
    },
    lanes: validationLanes.map((lane) => ({
      schema_version: 1,
      head_sha: head,
      tested_sha: tested,
      run_id: '123',
      run_attempt: 1,
      lane_id: lane.id,
      status: 'pass',
      runner_os: lane.platform ?? 'linux',
      bun_version: Bun.version,
      duration_ms: 1,
      checks: lane.checks.map((check) => ({
        id: check.id,
        command: check.command.join(' '),
        exit_code: 0,
        duration_ms: 1,
        evidence: [checkEvidencePath(lane.id, check.id)],
      })),
    })),
  }
}
