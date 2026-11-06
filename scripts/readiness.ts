import {readFile, unlink} from 'node:fs/promises'
import {resolve} from 'node:path'

import {redact} from '../src/domain/redact'
import {protectEvidenceOutput, readEvidence, writeEvidence} from './evidence-io'
import type {
  DeviationEvidence,
  EvidenceContext,
  LaneEvidence,
  ReadinessBundle,
  ReviewEvidence,
  VerifierEvidence,
} from './evidence-schema'
import {bundleSchema} from './evidence-schema'
import {acceptanceIds, laneById, requiredLaneIds} from './validation-lanes'
import {assessLane, failedExit} from './validation-policy'

export interface ReadinessProvider {
  context(context: EvidenceContext): Promise<void>
  artifact(ref: string, context: EvidenceContext, citingLane?: LaneEvidence): Promise<void>
  producer(record: ReviewEvidence | VerifierEvidence, context: EvidenceContext): Promise<void>
  deviation(record: DeviationEvidence, context: EvidenceContext): Promise<void>
  gate(record: ReadinessBundle['gate'], context: EvidenceContext): Promise<void>
}
const REASON_KINDS = {FAILURE: 'failure', BLOCKED: 'blocked'} as const
type ReasonKind = (typeof REASON_KINDS)[keyof typeof REASON_KINDS]
export async function readiness(value: unknown, pin: string, provider: ReadinessProvider) {
  const bundle = bundleSchema.parse(value),
    context = bundle.context
  const reasons: {kind: ReasonKind; subject: string; message: string}[] = []
  const add = (kind: ReasonKind, subject: string, message: string) => reasons.push({kind, subject, message})
  const authenticate = async (subject: string, action: () => Promise<void>) => {
    try {
      await action()
      return true
    } catch (error) {
      add('blocked', subject, redact(error instanceof Error ? error.message : String(error)))
      return false
    }
  }
  const identity = (record: {head_sha: string; tested_sha: string}, subject: string) => {
    if (record.head_sha !== context.head_sha || record.tested_sha !== context.tested_sha) {
      add('blocked', subject, 'Stale/mixed head or tested revision')
      return false
    }
    return true
  }
  const contextValid = await authenticate('context', () => provider.context(context))
  const acResults = new Map<string, VerifierEvidence['rows'][number]>()
  const laneResults = []
  for (const id of requiredLaneIds) {
    const lane = bundle.lanes.find((lane) => lane.lane_id === id)
    if (!lane) {
      add('blocked', id, 'Missing required lane')
      laneResults.push({lane_id: id, status: 'blocked'})
      continue
    }
    const policyValid = await authenticate(id, async () => {
      assessLane(lane, context, pin)
    })
    const laneValid = contextValid && policyValid
    let valid = laneValid
    for (const check of lane.checks) {
      let checkValid = laneValid
      for (const ref of check.evidence) {
        const authenticated = await authenticate(`${id}/${check.id}`, () => provider.artifact(ref, context, lane))
        checkValid = authenticated && checkValid
      }
      // Missing sibling logs block the lane, not a different check's proven failure.
      if (
        checkValid &&
        failedExit(
          check.exit_code,
          laneById(id).checks.find((expected) => expected.id === check.id)!,
        )
      )
        add('failure', `${id}/${check.id}`, 'Required check failed')
      valid = checkValid && valid
    }
    const status = valid ? lane.status : 'blocked'
    if (status !== 'pass') add('blocked', id, `Lane ${status}`)
    laneResults.push({lane_id: id, status, checks: lane.checks})
  }
  if (
    identity(bundle.gate, 'Deterministic gate') &&
    bundle.gate.run_id === context.run_id &&
    bundle.gate.run_attempt === context.run_attempt
  ) {
    const gateValid = await authenticate('Deterministic gate', () => provider.gate(bundle.gate, context))
    if (contextValid && gateValid && bundle.gate.conclusion === 'failure')
      add('failure', 'Deterministic gate', 'Provider gate failed')
    else if (bundle.gate.conclusion !== 'success')
      add('blocked', 'Deterministic gate', `Provider gate ${bundle.gate.conclusion}`)
  } else add('blocked', 'Deterministic gate', 'Gate run/attempt mismatch')
  for (const role of ['code', 'security'] as const) {
    const review = bundle.reviews.find((record) => record.role === role)
    if (!review) {
      add('blocked', role, 'Missing independent review role')
      continue
    }
    const valid =
      contextValid &&
      identity(review, role) &&
      review.provenance.producer_role === role &&
      (await authenticate(role, () => provider.producer(review, context)))
    if (!valid) add('blocked', role, 'Unverified producer/revision')
    if (review.completion !== 'complete') add('blocked', role, 'Independent review unavailable')
    for (const finding of review.findings) {
      if (valid && review.completion === 'complete' && finding.severity === 'blocking' && finding.status !== 'resolved')
        add('failure', `${role}/${finding.id}`, 'Open blocking finding')
      if (
        finding.severity === 'blocking' &&
        finding.status === 'resolved' &&
        finding.resolution_source_uri !== review.provenance.source_uri
      )
        add(
          'blocked',
          `${role}/${finding.id}`,
          'Resolution needs this independent producer’s exact-revision confirmation',
        )
      for (const ref of finding.evidence)
        await authenticate(`${role}/${finding.id}`, () => provider.artifact(ref, context))
    }
  }
  const verifier = bundle.verifier
  if (!verifier) add('blocked', 'verifier', 'Missing independent implementation-check attestation')
  else {
    const independent = !bundle.reviews.some(
      (review) =>
        review.provenance.producer_id === verifier.provenance.producer_id &&
        review.provenance.actor === verifier.provenance.actor,
    )
    if (!independent)
      add(
        'blocked',
        'verifier',
        'Implementation verification must come from a different producer than code/security review',
      )
    const valid =
      contextValid &&
      independent &&
      identity(verifier, 'verifier') &&
      verifier.provenance.producer_role === 'verifier' &&
      (await authenticate('verifier', () => provider.producer(verifier, context)))
    if (!valid || verifier.completion !== 'complete')
      add('blocked', 'verifier', 'Unavailable/unverified implementation-check producer')
    for (const row of verifier.rows) {
      let rowValid = valid && verifier.completion === 'complete'
      if (row.result === 'blocked') add('blocked', row.ac_id, 'Acceptance check blocked')
      if (row.result === 'pass' && row.exit_code !== 0) {
        add('blocked', row.ac_id, 'Pass contradicts command exit')
        rowValid = false
      }
      if (row.result === 'fail' && row.exit_code === 0) {
        add('blocked', row.ac_id, 'Failure contradicts command exit')
        rowValid = false
      }
      for (const ref of row.evidence) {
        const authenticated = await authenticate(row.ac_id, () => provider.artifact(ref, context))
        rowValid = authenticated && rowValid
      }
      if (rowValid && row.result === 'fail') add('failure', row.ac_id, 'Acceptance check failed')
      acResults.set(row.ac_id, rowValid ? row : {...row, result: 'blocked'})
    }
  }
  for (const deviation of bundle.deviations) {
    if (!contextValid || !identity(deviation, deviation.id)) continue
    if (deviation.approval.decision !== 'approved') add('failure', deviation.id, 'Unapproved/rejected deviation')
    else await authenticate(deviation.id, () => provider.deviation(deviation, context))
  }
  const verdict = reasons.some((reason) => reason.kind === REASON_KINDS.FAILURE)
    ? 'not-ready'
    : reasons.length
      ? 'blocked'
      : 'ready-for-owner-review'
  return {
    schema_version: 1,
    context,
    verdict,
    lane_results: laneResults,
    ac_results: acceptanceIds.map((id) => acResults.get(id) ?? {ac_id: id, result: 'blocked'}),
    reviews: bundle.reviews,
    deviations: bundle.deviations,
    remaining_risks: bundle.reviews.flatMap((review) => review.remaining_risks),
    reasons,
    evidence: [
      ...new Set([
        ...bundle.lanes.flatMap((lane) => lane.checks.flatMap((check) => check.evidence)),
        ...bundle.reviews.map((review) => review.provenance.source_uri),
        ...(verifier ? [verifier.provenance.source_uri] : []),
      ]),
    ],
    exit_code: verdict === 'ready-for-owner-review' ? 0 : verdict === 'not-ready' ? 1 : 2,
  }
}
/** Select from flag/value pairs exactly as the strict CLI parser does. */
export function readinessInputPath(args: string[], root: string): string {
  let input = resolve(root, 'results/readiness-input.json')
  for (let index = args[0] === '--' ? 1 : 0; index < args.length; index += 2)
    if (args[index] === '--input' && args[index + 1]) input = resolve(args[index + 1])
  return input
}
export async function readinessCLI(args: string[], provider: ReadinessProvider, root: string): Promise<number> {
  if (args[0] === '--') args = args.slice(1)
  const input = readinessInputPath(args, root)
  let output = resolve(root, 'results/readiness.json')
  let cleanupAllowed = false
  try {
    while (args.length) {
      const flag = args.shift(),
        value = args.shift()
      if (!value || !['--input', '--output'].includes(flag!))
        throw new Error('Usage: check:readiness -- --input <bundle> --output <report>')
      if (flag === '--output') output = resolve(value)
    }
    protectEvidenceOutput(input, output)
    try {
      const previous = JSON.parse(await readFile(output, 'utf8'))
      if (
        previous.schema_version !== 1 ||
        !['ready-for-owner-review', 'blocked', 'not-ready'].includes(previous.verdict) ||
        !Array.isArray(previous.ac_results) ||
        !Array.isArray(previous.lane_results)
      )
        throw new Error('Output is existing non-report data; refusing overwrite or cleanup')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    cleanupAllowed = true
    const value = JSON.parse(await readFile(input, 'utf8'))
    const report = await readiness(value, (await readFile(resolve(root, '.bun-version'), 'utf8')).trim(), provider)
    await writeEvidence(output, report)
    console.log(`${report.verdict}: ${report.reasons.length} reasons`)
    return report.exit_code
  } catch (error) {
    if (cleanupAllowed) await unlink(output).catch(() => {})
    console.error(redact(`Readiness blocked: ${error instanceof Error ? error.message : String(error)}`))
    return 2
  }
}
/** Collection is validity only; final readiness is computed once, separately. */
export async function collectReadiness(context: EvidenceContext, directory: string): Promise<ReadinessBundle> {
  const optional = async (path: string) => {
    try {
      return JSON.parse(await readEvidence(directory, path))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }
  const lanes = (await Promise.all(requiredLaneIds.map((id) => optional(`${id}.json`)))).filter((lane) => lane !== null)
  const reviews = (await Promise.all(['code', 'security'].map((role) => optional(`reviews/${role}.json`)))).filter(
    (review) => review !== null,
  )
  const verifier = await optional('verifier.json'),
    deviations = JSON.parse(await readEvidence(directory, 'deviations.json'))
  const gate = (await optional('gate.json')) ?? {
    schema_version: 1,
    name: 'Deterministic gate',
    head_sha: context.head_sha,
    tested_sha: context.tested_sha,
    run_id: context.run_id,
    run_attempt: context.run_attempt,
    provider_id: 'unavailable',
    conclusion: 'unavailable',
    source_uri: null,
  }
  return bundleSchema.parse({schema_version: 1, context, lanes, reviews, verifier, deviations, gate})
}
