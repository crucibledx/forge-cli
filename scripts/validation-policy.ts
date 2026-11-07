import type {EvidenceContext, LaneEvidence} from './evidence-schema'
import {laneSchema} from './evidence-schema'
import {checkEvidencePath} from './validation-evidence'
import type {ValidationCheck} from './validation-lanes'
import {LANE_BUDGET_MS, laneById} from './validation-lanes'

export const blockedExit = (exit: number | null, check: ValidationCheck) =>
  exit === null || Boolean(check.blocked_exits?.includes(exit))
export const failedExit = (exit: number | null, check: ValidationCheck) => exit !== 0 && !blockedExit(exit, check)
export const aggregateExit = (lanes: LaneEvidence[]) =>
  lanes.some((lane) => lane.status === 'fail') ? 1 : lanes.some((lane) => lane.status !== 'pass') ? 2 : 0

export function assessLane(value: unknown, context: EvidenceContext, pin: string): LaneEvidence {
  const lane = laneSchema.parse(value)
  const definition = laneById(lane.lane_id)
  for (const key of ['head_sha', 'tested_sha', 'run_id', 'run_attempt'] as const)
    if (lane[key] !== context[key]) throw new Error(`${lane.lane_id}: stale/mixed ${key}`)
  if (lane.bun_version !== pin) throw new Error(`${lane.lane_id}: incorrect Bun pin`)
  if (definition.platform && lane.runner_os !== definition.platform && lane.status === 'pass')
    throw new Error(`${lane.lane_id}: foreign-native execution cannot pass`)
  if (lane.duration_ms > LANE_BUDGET_MS && lane.status === 'pass') throw new Error(`${lane.lane_id}: deadline exceeded`)
  if (lane.checks.length !== definition.checks.length) throw new Error(`${lane.lane_id}: incomplete checks`)
  for (const expected of definition.checks) {
    const actual = lane.checks.find((check) => check.id === expected.id)
    if (!actual || actual.command !== expected.command.join(' '))
      throw new Error(`${lane.lane_id}: missing/incorrect command ${expected.id}`)
    if (blockedExit(actual.exit_code, expected) && !actual.reason)
      throw new Error(`${lane.lane_id}: missing blocked/cancellation reason`)
    if (actual.evidence.length !== 1 || actual.evidence[0] !== checkEvidencePath(lane.lane_id, expected.id))
      throw new Error(`${lane.lane_id}: check requires its own selected-run artifact`)
  }
  if (lane.status === 'pass' && lane.checks.some((check) => check.exit_code !== 0))
    throw new Error(`${lane.lane_id}: claimed pass contradicts checks`)
  if (
    lane.status === 'fail' &&
    !lane.checks.some((check) =>
      failedExit(
        check.exit_code,
        definition.checks.find((expected) => expected.id === check.id)!,
      ),
    )
  )
    throw new Error(`${lane.lane_id}: claimed failure lacks failed check`)
  return lane
}
