import {readEvidence} from '../evidence-io'
import type {ReadinessBundle} from '../evidence-schema'
import type {ReadinessProvider} from '../readiness'
import {acceptanceIds, requiredLaneIds, validationLanes} from '../validation-lanes'
import {checkEvidencePath} from '../validation-policy'

export function readinessFixture(): ReadinessBundle {
  const head = 'a'.repeat(40),
    tested = 'b'.repeat(40)
  const provenance = (role: 'code' | 'security' | 'verifier') => ({
    producer_role: role,
    actor: 'independent-fixture',
    source_uri: `factory-session://11111111-1111-4111-8111-111111111111/${role === 'code' ? '22222222-2222-4222-8222-222222222222' : role === 'security' ? '33333333-3333-4333-8333-333333333333' : '44444444-4444-4444-8444-444444444444'}`,
    report_sha256: 'd'.repeat(64),
    completed_at: '2026-11-04T12:00:00.000Z',
    producer_id: `fixture-${role}`,
  })
  return {
    schema_version: 1,
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
    reviews: (['code', 'security'] as const).map((role) => ({
      schema_version: 1,
      role,
      head_sha: head,
      tested_sha: tested,
      completion: 'complete',
      provenance: provenance(role),
      findings: [],
      remaining_risks: [],
    })),
    verifier: {
      schema_version: 1,
      phase: 'implementation-checks',
      head_sha: head,
      tested_sha: tested,
      completion: 'complete',
      provenance: provenance('verifier'),
      rows: acceptanceIds.map((ac_id) => ({
        ac_id,
        result: 'pass',
        command: 'bun run test:contracts (synthetic fixture only)',
        exit_code: 0,
        evidence: ['fixtures/check.log'],
      })),
    },
    deviations: [],
    gate: {
      schema_version: 1,
      name: 'Deterministic gate',
      head_sha: head,
      tested_sha: tested,
      run_id: '123',
      run_attempt: 1,
      provider_id: '456',
      conclusion: 'success',
      source_uri: 'https://github.com/crucibledx/forge-cli/actions/runs/123/job/456',
    },
  }
}
/** Test-only authenticated provider boundary. Production never imports this module. */
export function fixtureProvider(directory: string, original: ReadinessBundle): ReadinessProvider {
  const expected = structuredClone(original)
  return {
    async context(context) {
      if (JSON.stringify(context) !== JSON.stringify(expected.context)) throw new Error('Fixture context mismatch')
    },
    async artifact(ref) {
      if (
        ![
          'fixtures/check.log',
          ...expected.lanes.flatMap((lane) => lane.checks.flatMap((check) => check.evidence)),
        ].includes(ref) ||
        (await readEvidence(directory, ref)).trim() !== 'authenticated fixture evidence'
      )
        throw new Error('Missing/invalid fixture artifact')
    },
    async producer(record) {
      if (
        ![...expected.reviews, ...(expected.verifier ? [expected.verifier] : [])].some(
          (item) => JSON.stringify(item) === JSON.stringify(record),
        )
      )
        throw new Error('Spoofed/edited producer attestation')
    },
    async deviation() {
      throw new Error('No matching authenticated owner approval')
    },
    async gate(record) {
      if (JSON.stringify(record) !== JSON.stringify(expected.gate)) throw new Error('Provider gate mismatch')
    },
  }
}
