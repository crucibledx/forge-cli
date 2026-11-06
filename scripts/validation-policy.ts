import type {EvidenceContext, LaneEvidence} from './evidence-schema'
import {laneSchema} from './evidence-schema'
import {checkEvidencePath} from './validation-evidence'
import {laneById} from './validation-lanes'

export const failedExit = (exit: number | null) => exit !== null && ![0, 2].includes(exit)
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
  if (lane.duration_ms > definition.timeout_ms && lane.status === 'pass')
    throw new Error(`${lane.lane_id}: deadline exceeded`)
  if (lane.checks.length !== definition.checks.length) throw new Error(`${lane.lane_id}: incomplete checks`)
  for (const expected of definition.checks) {
    const actual = lane.checks.find((check) => check.id === expected.id)
    if (!actual || actual.command !== expected.command.join(' '))
      throw new Error(`${lane.lane_id}: missing/incorrect command ${expected.id}`)
    if ((actual.exit_code === null || actual.exit_code === 2) && !actual.reason)
      throw new Error(`${lane.lane_id}: missing blocked/cancellation reason`)
    if (actual.evidence.length !== 1 || actual.evidence[0] !== checkEvidencePath(lane.lane_id, expected.id))
      throw new Error(`${lane.lane_id}: check requires its own selected-run artifact`)
  }
  if (lane.status === 'pass' && lane.checks.some((check) => check.exit_code !== 0))
    throw new Error(`${lane.lane_id}: claimed pass contradicts checks`)
  if (lane.status === 'fail' && !lane.checks.some((check) => failedExit(check.exit_code)))
    throw new Error(`${lane.lane_id}: claimed failure lacks failed check`)
  return lane
}
