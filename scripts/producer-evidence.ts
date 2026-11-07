import {z} from 'zod'

import {hashContent} from '../src/domain/sync/state'
import type {EvidenceContext, ReviewEvidence, VerifierEvidence} from './evidence-schema'
import {githubJSON} from './github-evidence'
import {producerPayload} from './producer-payload'
import type {ProducerRole} from './producer-roles'
import {MAX_EVIDENCE_BYTES} from './validation-evidence'

type Payload = z.infer<typeof producerPayload>
type HistoryMetadata = {submitted_at?: string; contested?: boolean; version_sha256?: string}
export type AuthenticatedVerifier = HistoryMetadata & {
  record: VerifierEvidence
  dismissed: boolean
  also_reviewed: boolean
}
export type AuthenticatedReview = HistoryMetadata & {record: ReviewEvidence; dismissed: boolean}
export type ProducerHistory = {reviews: AuthenticatedReview[]; verifiers: AuthenticatedVerifier[]}
export const MAX_SELECTED_PRODUCERS = 100

/** These are routing references, never verdict authority. Every candidate is authenticated again by the checker. */
export function producerSelection(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((uri) => typeof uri !== 'string'))
    throw new Error('Invalid producer selection')
  if (value.length > MAX_SELECTED_PRODUCERS) throw new Error('Too many selected producers')
  if (new Set(value).size !== value.length) throw new Error('Duplicate producer selection')
  return value
}
const reviewSchema = z.object({
  id: z.number().int().positive(),
  user: z.object({login: z.literal('factory-droid[bot]'), type: z.literal('Bot')}),
  commit_id: z.string(),
  submitted_at: z.iso.datetime({offset: true}),
  state: z.enum(['APPROVED', 'COMMENTED', 'CHANGES_REQUESTED', 'DISMISSED']),
  html_url: z.string(),
  body: z.string().max(256 * 1024),
})
type Review = z.infer<typeof reviewSchema>
const records = (payload: Payload) => [...payload.reviews, ...(payload.verifier ? [payload.verifier] : [])]
const roleOf = (record: ReturnType<typeof records>[number]): ProducerRole =>
  'role' in record ? record.role : 'verifier'

/** Transport authenticated history on lookup failure; readiness still validates every finding/row's evidence. */
export class ProducerBlockers extends Error {
  constructor(
    cause?: unknown,
    readonly verifiers: AuthenticatedVerifier[] = [],
    readonly reviews: AuthenticatedReview[] = [],
  ) {
    super(
      'Current independent provider verdicts require validation' + (cause === undefined ? '' : `; ${String(cause)}`),
      {cause},
    )
  }
}
export class ProducerSuperseded extends ProducerBlockers {}

export function assertProducerRecord(payload: Payload, record: ReviewEvidence | VerifierEvidence): void {
  if (!records(payload).some((item) => JSON.stringify(item) === JSON.stringify(record)))
    throw new Error('Sidecar is not the independent producer’s exact structured verdict')
}

function authenticateReview(value: unknown, context: EvidenceContext) {
  const review = reviewSchema.parse(value)
  const uri = `https://github.com/${context.repository}/pull/${context.pr_number}#pullrequestreview-${review.id}`
  if (review.commit_id !== context.head_sha || review.html_url !== uri)
    throw new Error('Independent provider review identity/revision mismatch')
  const blocks = [...review.body.matchAll(/```forge-evidence-v1\n([\s\S]*?)\n```/g)]
  if (blocks.length !== 1) throw new Error('Independent provider supplied no unique structured attestation')
  const payload = producerPayload.parse(JSON.parse(blocks[0][1]))
  const hash = hashContent(payload.raw_report_markdown)
  if (!records(payload).length) throw new Error('Independent provider supplied no verdict')
  for (const record of records(payload)) {
    const p = record.provenance,
      completed = Date.parse(p.completed_at),
      submitted = Date.parse(review.submitted_at)
    if (
      record.head_sha !== context.head_sha ||
      record.tested_sha !== context.tested_sha ||
      p.actor !== review.user.login ||
      p.producer_id !== String(review.id) ||
      p.source_uri !== uri ||
      p.report_sha256 !== hash ||
      !Number.isFinite(completed) ||
      completed < submitted - 300000 ||
      completed > submitted + 5000 ||
      p.producer_role !== roleOf(record)
    )
      throw new Error('Independent provider attestation does not bind its verdict, actor, report and exact revision')
  }
  return {review, payload}
}

async function selectedProducer(uri: string, context: EvidenceContext, read: typeof githubJSON) {
  if (uri.startsWith('factory-session://'))
    throw new Error('Writable local session transcripts are supporting reports, not authenticated independent approval')
  const url = new URL(uri)
  const match = /^#pullrequestreview-(\d+)$/.exec(url.hash)
  if (
    url.origin !== 'https://github.com' ||
    url.search ||
    !match ||
    url.pathname !== `/${context.repository}/pull/${context.pr_number}`
  )
    throw new Error('Producer must be a review on the selected PR')
  const source = authenticateReview(await read(context, `/pulls/${context.pr_number}/reviews/${match[1]}`), context)
  if (String(source.review.id) !== match[1] || source.review.html_url !== uri)
    throw new Error('Independent provider review identity/revision mismatch')
  return source
}

/** Authenticate report bytes only; producer verdicts additionally require the current role's review history. */
export async function providerReport(uri: string, context: EvidenceContext, read = githubJSON) {
  return (await selectedProducer(uri, context, read)).payload
}

function order(a: Review, b: Review) {
  return Date.parse(a.submitted_at) - Date.parse(b.submitted_at) || a.id - b.id
}

type AuthenticatedSource = ReturnType<typeof authenticateReview> & {contested?: boolean}
function historyState(history: AuthenticatedSource[], roles: Set<ProducerRole>) {
  const latest = new Map<ProducerRole, number>()
  const open = new Set<string>()
  const verifiers: AuthenticatedVerifier[] = []
  const reviews: AuthenticatedReview[] = []
  for (const source of [...history].sort((a, b) => order(a.review, b.review)))
    for (const record of records(source.payload)) {
      const currentRole = roleOf(record)
      const metadata = {
        submitted_at: source.review.submitted_at,
        version_sha256: hashContent(JSON.stringify(source.review)),
        ...(source.contested ? {contested: true} : {}),
      }
      if ('rows' in record)
        verifiers.push({
          record,
          dismissed: source.review.state === 'DISMISSED',
          also_reviewed: source.payload.reviews.length > 0,
          ...metadata,
        })
      else reviews.push({record, dismissed: source.review.state === 'DISMISSED', ...metadata})
      if (!roles.has(currentRole)) continue
      latest.set(currentRole, source.review.id)
      if ('findings' in record && record.completion === 'complete')
        for (const finding of record.findings) {
          const subject = `${currentRole}/${finding.id}`
          if (finding.severity !== 'blocking') continue
          if (finding.status === 'resolved') {
            if (
              !source.contested &&
              source.review.state !== 'DISMISSED' &&
              finding.resolution_source_uri === source.review.html_url
            )
              open.delete(subject)
          } else open.add(subject)
        }
    }
  return {latest, open, verifiers, reviews}
}

/** Authenticated history still requires independent finding/row artifact validation by readiness. */
export async function providerProducerState(
  uri: string,
  context: EvidenceContext,
  read = githubJSON,
  role?: ProducerRole,
  candidates: () => Promise<string[]> = async () => [],
) {
  const roles = new Set<ProducerRole>(role ? [role] : [])
  const history: AuthenticatedSource[] = []
  try {
    const unavailable: string[] = []
    let primary: ReturnType<typeof authenticateReview> | undefined
    try {
      primary = await selectedProducer(uri, context, read)
      history.push(primary)
      if (!role) for (const record of records(primary.payload)) roles.add(roleOf(record))
    } catch (error) {
      unavailable.push(String(error))
    }
    // Keep every selected candidate through artifact/row validation, including when the first history page is down.
    for (const candidate of producerSelection(await candidates())) {
      if (candidate === uri) continue
      try {
        const source = await selectedProducer(candidate, context, read)
        history.push(source)
        if (!role && !primary) for (const record of records(source.payload)) roles.add(roleOf(record))
      } catch (error) {
        unavailable.push(String(error))
      }
    }
    if (!primary) throw new Error(`Selected independent producer unavailable: ${unavailable.join('; ')}`)
    const selected = primary
    const seen = new Set<number>()
    const listed = new Map<number, typeof selected>()
    const counted = new Set(history.map((source) => source.review.id))
    let reportBytes = history.reduce((total, source) => total + Buffer.byteLength(source.review.body), 0)
    let complete = false
    for (let page = 1; page <= 100; page++) {
      const reviews = z
        .array(z.object({id: z.number().int().positive()}).passthrough())
        .max(100)
        .parse(
          await read(context, `/pulls/${context.pr_number}/reviews?per_page=100${page === 1 ? '' : `&page=${page}`}`),
        )
      for (const raw of reviews) {
        if (seen.has(raw.id)) throw new Error('Duplicate provider review page entry')
        seen.add(raw.id)
        const actor = z
          .object({login: z.string().min(1), type: z.enum(['User', 'Bot', 'Organization', 'Mannequin'])})
          .safeParse(raw.user)
        if (!actor.success) {
          unavailable.push('Malformed provider review actor')
          continue
        }
        if (actor.data.login !== 'factory-droid[bot]') continue
        if (actor.data.type !== 'Bot' || typeof raw.commit_id !== 'string') {
          unavailable.push('Malformed independent provider actor/revision')
          continue
        }
        if (raw.commit_id !== context.head_sha) continue
        if (raw.state === 'PENDING') {
          if (raw.id > selected.review.id) unavailable.push('A newer independent provider review is pending')
          continue
        }
        if (!counted.has(raw.id) && typeof raw.body === 'string') {
          reportBytes += Buffer.byteLength(raw.body)
          counted.add(raw.id)
        }
        if (reportBytes > MAX_EVIDENCE_BYTES) throw new Error('Current provider review history oversized')
        const timestamp = z.iso.datetime({offset: true}).safeParse(raw.submitted_at)
        if (!timestamp.success) {
          unavailable.push('Malformed provider review timestamp')
          continue
        }
        const time = timestamp.data
        const later =
          Date.parse(time) > Date.parse(selected.review.submitted_at) ||
          (Date.parse(time) === Date.parse(selected.review.submitted_at) && raw.id > selected.review.id)
        try {
          // An older empty COMMENTED shell claims no verdict. Do not extend
          // this to prose, malformed payloads, selected IDs or newer output.
          if (
            !later &&
            raw.id !== selected.review.id &&
            raw.state === 'COMMENTED' &&
            typeof raw.body === 'string' &&
            !raw.body.trim()
          ) {
            const empty = reviewSchema.parse(raw)
            if (
              empty.html_url !==
              `https://github.com/${context.repository}/pull/${context.pr_number}#pullrequestreview-${empty.id}`
            )
              throw new Error('Independent provider review identity/revision mismatch')
            continue
          }
          // Another integrated revision cannot supersede this exact merge.
          const blocks =
            typeof raw.body === 'string' ? [...raw.body.matchAll(/```forge-evidence-v1\n([\s\S]*?)\n```/g)] : []
          if (blocks.length === 1) {
            const shape = producerPayload.parse(JSON.parse(blocks[0][1]))
            if (records(shape).length && records(shape).every((record) => record.tested_sha !== context.tested_sha))
              continue
          }
          const source: AuthenticatedSource = authenticateReview(raw, context)
          if (
            raw.state === 'DISMISSED' &&
            (later || raw.id === selected.review.id) &&
            records(source.payload).some((record) => roles.has(roleOf(record)))
          )
            unavailable.push('Current independent provider review is dismissed')
          listed.set(source.review.id, source)
          const previous = history.find((item) => item.review.id === source.review.id)
          if (previous && JSON.stringify(previous.review) !== JSON.stringify(source.review)) {
            unavailable.push('Selected provider review changed in current listing')
            // Both versions are authenticated, but an edited same-ID pass/resolution cannot erase an adverse version.
            previous.contested = source.contested = true
            history.push(source)
          } else if (!previous) history.push(source)
        } catch (error) {
          unavailable.push(String(error))
        }
      }
      if (reviews.length < 100) {
        complete = true
        break
      }
    }
    if (!complete) throw new Error('Provider review pagination limit exceeded')
    const listedSelection = listed.get(selected.review.id)
    if (!listedSelection || JSON.stringify(listedSelection.review) !== JSON.stringify(selected.review))
      throw new Error('Selected provider review missing or changed in current listing')
    if (history.some((source) => !listed.has(source.review.id)))
      unavailable.push('Selected candidate missing from current listing')
    const {latest, open, verifiers, reviews} = historyState(history, roles)
    if (unavailable.length) throw new Error(`Current provider review unavailable: ${unavailable.join('; ')}`)
    if ([...roles].some((currentRole) => latest.get(currentRole) !== selected.review.id))
      throw new ProducerSuperseded(
        new Error('Selected producer verdict is superseded by a later exact-revision review'),
        verifiers,
        reviews,
      )
    const selectedOpen = new Set(
      selected.payload.reviews.flatMap((record) =>
        (record.completion === 'complete' ? record.findings : [])
          .filter((f) => f.severity === 'blocking' && f.status === 'open')
          .map((f) => `${record.role}/${f.id}`),
      ),
    )
    if ([...open].some((subject) => !selectedOpen.has(subject)))
      throw new ProducerBlockers(undefined, verifiers, reviews)
    return {payload: selected.payload, verifiers, reviews}
  } catch (error) {
    if (error instanceof ProducerBlockers) throw error
    // Incomplete history cannot erase failures already proved by the independent app.
    const {verifiers, reviews} = historyState(history, roles)
    throw new ProducerBlockers(error, verifiers, reviews)
  }
}
