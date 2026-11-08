import {readFile, unlink} from 'node:fs/promises'
import {dirname, resolve} from 'node:path'

import {redact} from '../src/domain/redact'
import {terminalText} from '../src/infrastructure/cli/terminal-text'
import {createConfinement} from '../src/infrastructure/fs/confinement'
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
import type {AuthenticatedReview, AuthenticatedVerifier, ProducerHistory} from './producer-evidence'
import {ProducerBlockers} from './producer-evidence'
import {REVIEW_ROLES} from './producer-roles'
import {repositoryRoot} from './validation-identity'
import {acceptanceIds, laneById, requiredLaneIds} from './validation-lanes'
import {assessLane, failedExit} from './validation-policy'

export interface ReadinessProvider {
  context(context: EvidenceContext): Promise<void>
  artifact(ref: string, context: EvidenceContext, citingLane?: LaneEvidence): Promise<void>
  producer(record: ReviewEvidence | VerifierEvidence, context: EvidenceContext): Promise<void | ProducerHistory>
  deviation(record: DeviationEvidence, context: EvidenceContext): Promise<void>
  gate(record: ReadinessBundle['gate'], context: EvidenceContext): Promise<void>
}
const REASON_KINDS = {FAILURE: 'failure', BLOCKED: 'blocked'} as const
type ReasonKind = (typeof REASON_KINDS)[keyof typeof REASON_KINDS]
// Merge overlapping lookups in provider submission order, not in the order their endpoints happened to finish.
function historyOrder(a: AuthenticatedReview | AuthenticatedVerifier, b: AuthenticatedReview | AuthenticatedVerifier) {
  return (
    Date.parse(a.submitted_at ?? a.record.provenance.completed_at) -
      Date.parse(b.submitted_at ?? b.record.provenance.completed_at) ||
    Number(a.record.provenance.producer_id) - Number(b.record.provenance.producer_id)
  )
}
export async function readiness(value: unknown, pin: string, provider: ReadinessProvider) {
  const bundle = bundleSchema.parse(value),
    context = bundle.context
  const reasons: {kind: ReasonKind; subject: string; message: string}[] = []
  const currentProducerEvidence = new Set<string>()
  const verifierHistory: AuthenticatedVerifier[] = []
  const reviewHistory: AuthenticatedReview[] = []
  const authenticatedReviews: ReviewEvidence[] = []
  const add = (kind: ReasonKind, subject: string, message: string) => reasons.push({kind, subject, message})
  const authenticate = async (subject: string, action: () => Promise<unknown>) => {
    try {
      await action()
      return true
    } catch (error) {
      if (error instanceof ProducerBlockers) {
        verifierHistory.push(...error.verifiers)
        reviewHistory.push(...error.reviews)
      }
      add('blocked', subject, redact(error instanceof Error ? error.message : String(error)))
      return false
    }
  }
  const authenticateProducer = async (record: ReviewEvidence | VerifierEvidence) => {
    const history = await provider.producer(record, context)
    if (history) {
      verifierHistory.push(...history.verifiers)
      reviewHistory.push(...history.reviews)
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
  for (const role of REVIEW_ROLES) {
    const review = bundle.reviews.find((record) => record.role === role)
    if (!review) {
      add('blocked', role, 'Missing independent review role')
      continue
    }
    const valid =
      contextValid &&
      identity(review, role) &&
      review.provenance.producer_role === role &&
      (await authenticate(role, () => authenticateProducer(review)))
    if (valid) authenticatedReviews.push(review)
    if (!valid) add('blocked', role, 'Unverified producer/revision')
    if (review.completion !== 'complete') add('blocked', role, 'Independent review unavailable')
    for (const finding of review.findings) {
      let findingValid = valid && review.completion === 'complete'
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
        findingValid =
          (await authenticate(`${role}/${finding.id}`, () => provider.artifact(ref, context))) && findingValid
      if (findingValid && finding.severity === 'blocking' && finding.status === 'open')
        add('failure', `${role}/${finding.id}`, 'Open blocking finding')
    }
  }
  const reviewed = [...authenticatedReviews, ...reviewHistory.map(({record}) => record)]
  const verifier = bundle.verifier
  if (!verifier) add('blocked', 'verifier', 'Missing independent implementation-check attestation')
  else {
    const independent = !reviewed.some(
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
      identity(verifier, 'verifier') &&
      verifier.provenance.producer_role === 'verifier' &&
      (await authenticate('verifier', () => authenticateProducer(verifier))) &&
      independent
    if (!valid || verifier.completion !== 'complete')
      add('blocked', 'verifier', 'Unavailable/unverified implementation-check producer')
    for (const row of verifier.rows) {
      let rowValid = valid && verifier.completion === 'complete'
      if (row.result === 'blocked') add('blocked', row.ac_id, 'Acceptance check blocked')
      if (row.result === 'pass' && row.exit_code !== 0) {
        add('blocked', row.ac_id, 'Pass contradicts command exit')
        rowValid = false
      }
      if (row.result === 'fail' && (row.exit_code === 0 || row.exit_code === null)) {
        add('blocked', row.ac_id, 'Failure lacks a nonzero command exit')
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
  // A history outage/superseded selection must not hide an independently proved failing AC.
  // Historical pass rows clear a prior failure only with valid evidence, never by omission/dismissal.
  const knownFailures = new Map<string, {row: VerifierEvidence['rows'][number]; source_uri: string}>()
  const artifacts = new Map<string, Promise<boolean>>()
  const verifiedArtifact = (ref: string) => {
    if (!artifacts.has(ref))
      artifacts.set(
        ref,
        authenticate(ref, () => provider.artifact(ref, context)),
      )
    return artifacts.get(ref)!
  }
  // Historical resolutions need the same artifact authority as selected findings, before they can clear a blocker.
  const openFindings = new Map<string, {source_uri: string; evidence: string[]}>()
  const contestedSources = new Set(
    [...reviewHistory, ...verifierHistory]
      .filter((source) => source.contested)
      .map((source) => source.record.provenance.source_uri),
  )
  const observedVersions = new Map<string, string>()
  for (const source of [...reviewHistory, ...verifierHistory]) {
    const uri = source.record.provenance.source_uri
    const key = source.version_sha256 ? uri : `${uri}/${source.record.provenance.producer_role}`
    const version =
      source.version_sha256 ??
      JSON.stringify([
        source.record,
        source.dismissed,
        source.submitted_at,
        'also_reviewed' in source ? source.also_reviewed : undefined,
      ])
    const previous = observedVersions.get(key)
    if (previous !== undefined && previous !== version) contestedSources.add(uri)
    observedVersions.set(key, version)
  }
  for (const uri of contestedSources)
    add('blocked', uri, 'Conflicting authenticated producer versions cannot clear adverse evidence')
  for (const {record, dismissed} of contextValid ? reviewHistory.sort(historyOrder) : []) {
    if (
      record.completion !== 'complete' ||
      record.head_sha !== context.head_sha ||
      record.tested_sha !== context.tested_sha ||
      record.provenance.producer_role !== record.role
    )
      continue
    for (const finding of record.findings) {
      if (finding.severity !== 'blocking') continue
      let proven = true
      for (const ref of finding.evidence) proven = (await verifiedArtifact(ref)) && proven
      if (!proven) continue
      const subject = `${record.role}/${finding.id}`
      if (finding.status === 'open')
        openFindings.set(subject, {source_uri: record.provenance.source_uri, evidence: finding.evidence})
      else if (
        !dismissed &&
        !contestedSources.has(record.provenance.source_uri) &&
        finding.resolution_source_uri === record.provenance.source_uri
      )
        openFindings.delete(subject)
      else add('blocked', subject, 'Resolution needs this independent producer’s exact-revision confirmation')
    }
  }
  for (const [subject, finding] of openFindings) {
    if (!reasons.some((reason) => reason.kind === 'failure' && reason.subject === subject))
      add('failure', subject, 'Open blocking finding')
    for (const ref of [finding.source_uri, ...finding.evidence]) currentProducerEvidence.add(ref)
  }
  for (const {record, dismissed, also_reviewed, version_sha256} of contextValid
    ? verifierHistory.sort(historyOrder)
    : []) {
    // The production hash binds this version's own role participation. A later
    // edited report cannot retroactively make its prior independent failure vanish.
    if (
      also_reviewed ||
      record.completion !== 'complete' ||
      record.head_sha !== context.head_sha ||
      record.tested_sha !== context.tested_sha ||
      record.provenance.producer_role !== 'verifier' ||
      (!version_sha256 &&
        reviewed.some(
          (review) =>
            review.provenance.actor === record.provenance.actor &&
            review.provenance.producer_id === record.provenance.producer_id,
        ))
    )
      continue
    for (const row of record.rows) {
      if (
        row.result === 'blocked' ||
        (row.result === 'pass' &&
          (dismissed || contestedSources.has(record.provenance.source_uri) || row.exit_code !== 0)) ||
        (row.result === 'fail' && (row.exit_code === 0 || row.exit_code === null))
      )
        continue
      let proven = true
      for (const ref of row.evidence) proven = (await verifiedArtifact(ref)) && proven
      if (!proven) continue
      if (row.result === 'fail') knownFailures.set(row.ac_id, {row, source_uri: record.provenance.source_uri})
      else knownFailures.delete(row.ac_id)
    }
  }
  for (const {row, source_uri} of knownFailures.values()) {
    if (!reasons.some((reason) => reason.kind === 'failure' && reason.subject === row.ac_id))
      add('failure', row.ac_id, 'Acceptance check failed')
    acResults.set(row.ac_id, row)
    for (const ref of [source_uri, ...row.evidence]) currentProducerEvidence.add(ref)
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
    ac_results: acceptanceIds.map((id) => {
      const row = acResults.get(id)
      return row ? {...row, command: redact(row.command)} : {ac_id: id, result: 'blocked'}
    }),
    reviews: bundle.reviews.map((review) => ({
      ...review,
      remaining_risks: review.remaining_risks.map((risk) => redact(risk)),
    })),
    deviations: bundle.deviations.map((deviation) => ({...deviation, description: redact(deviation.description)})),
    remaining_risks: bundle.reviews.flatMap((review) => review.remaining_risks.map((risk) => redact(risk))),
    reasons: reasons.map((reason) => ({...reason, message: redact(reason.message)})),
    evidence: [
      ...new Set([
        ...currentProducerEvidence,
        ...bundle.lanes.flatMap((lane) => lane.checks.flatMap((check) => check.evidence)),
        ...bundle.reviews.map((review) => review.provenance.source_uri),
        ...(verifier ? [verifier.provenance.source_uri] : []),
      ]),
    ],
    exit_code: verdict === 'ready-for-owner-review' ? 0 : verdict === 'not-ready' ? 1 : 2,
  }
}
/** Select from flag/value pairs exactly as the strict CLI parser does. */
export function readinessInputPath(args: string[]): string {
  let input = resolve(repositoryRoot, 'results/readiness-input.json')
  for (let index = args[0] === '--' ? 1 : 0; index < args.length; index += 2)
    if (args[index] === '--input' && args[index + 1]) input = resolve(args[index + 1])
  return input
}
export async function readinessCLI(args: string[], provider: ReadinessProvider): Promise<number> {
  if (args[0] === '--') args = args.slice(1)
  const input = readinessInputPath(args)
  let output = resolve(dirname(input), 'readiness.json')
  let cleanupAllowed = false
  let boundary: Awaited<ReturnType<typeof createConfinement>> | undefined
  try {
    while (args.length) {
      const flag = args.shift(),
        value = args.shift()
      if (!value || !['--input', '--output'].includes(flag!))
        throw new Error('Usage: check:readiness -- --input <bundle> --output <report>')
      if (flag === '--output') output = resolve(value)
    }
    boundary = await createConfinement(dirname(input))
    output = await boundary.resolve(output)
    const selectedInput = await boundary.resolve(input)
    protectEvidenceOutput(selectedInput, output)
    try {
      const previous = JSON.parse(await readEvidence(boundary.root, output))
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
    const value = JSON.parse(await readEvidence(boundary.root, selectedInput))
    const report = await readiness(
      value,
      (await readFile(resolve(repositoryRoot, '.bun-version'), 'utf8')).trim(),
      provider,
    )
    await writeEvidence(output, report, boundary.root)
    console.log(`${report.verdict}: ${report.reasons.length} reasons`)
    return report.exit_code
  } catch (error) {
    if (cleanupAllowed && boundary)
      await boundary
        .resolve(output)
        .then(unlink)
        .catch(() => {})
    console.error(terminalText(`Readiness blocked: ${error instanceof Error ? error.message : String(error)}`))
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
  const reviews = (await Promise.all(REVIEW_ROLES.map((role) => optional(`reviews/${role}.json`)))).filter(
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
