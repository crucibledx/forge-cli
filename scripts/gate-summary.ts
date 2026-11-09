import type {EvidenceContext} from './evidence-schema'
import {validationLanes} from './validation-lanes'

/** No runtime dependencies beyond the registry: usable after a failed installation. */
export function blockedGateSummary(reason: string, context: EvidenceContext | null = null) {
  return {
    schema_version: 1,
    context,
    conclusion: 'failure',
    provider_errors: [reason],
    lanes: validationLanes.map((lane) => ({
      lane_id: lane.id,
      status: 'blocked',
      reason,
      evidence: null,
      provider_job_id: null,
      artifact_id: null,
    })),
  }
}
