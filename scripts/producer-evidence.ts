import {z} from 'zod'

import {hashContent} from '../src/domain/sync/state'
import type {EvidenceContext} from './evidence-schema'
import {githubJSON} from './github-evidence'
import {producerPayload} from './producer-payload'
import {MAX_EVIDENCE_BYTES} from './validation-evidence'

type ProducerRole = 'code' | 'security' | 'verifier'
type Payload = z.infer<typeof producerPayload>
const reviewSchema = z.object({
  id: z.number().int().positive(),
  user: z.object({login: z.literal('factory-droid[bot]'), type: z.literal('Bot')}),
  commit_id: z.string(),
  submitted_at: z.iso.datetime({offset: true}),
  state: z.enum(['APPROVED', 'COMMENTED', 'CHANGES_REQUESTED']),
  html_url: z.string(),
  body: z.string().max(256 * 1024),
})
type Review = z.infer<typeof reviewSchema>
const records = (payload: Payload) => [...payload.reviews, ...(payload.verifier ? [payload.verifier] : [])]
const roleOf = (record: ReturnType<typeof records>[number]): ProducerRole =>
  'role' in record ? record.role : 'verifier'

/** Only an authenticated independent verdict can establish these failures. */
export class ProducerBlockers extends Error {
  constructor(
    readonly findings: {subject: string; source_uri: string}[],
    cause?: unknown,
  ) {
    super(
      'Current independent provider reviews contain unresolved blocking findings' +
        (cause === undefined ? '' : '; current provider review history unavailable'),
      {cause},
    )
  }
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

function historyState(history: ReturnType<typeof authenticateReview>[], roles: Set<ProducerRole>) {
  const latest = new Map<ProducerRole, number>()
  const open = new Map<string, {subject: string; source_uri: string}>()
  for (const source of [...history].sort((a, b) => order(a.review, b.review)))
    for (const record of records(source.payload)) {
      const currentRole = roleOf(record)
      if (!roles.has(currentRole)) continue
      latest.set(currentRole, source.review.id)
      if ('findings' in record)
        for (const finding of record.findings) {
          const subject = `${currentRole}/${finding.id}`
          if (finding.severity !== 'blocking') continue
          if (finding.status === 'resolved' && finding.resolution_source_uri === source.review.html_url)
            open.delete(subject)
          else open.set(subject, {subject, source_uri: source.review.html_url})
        }
    }
  return {latest, open}
}

/** Trust current independent verdicts, not a staged choice of an obsolete passing review. */
export async function providerProducer(uri: string, context: EvidenceContext, read = githubJSON, role?: ProducerRole) {
  const selected = await selectedProducer(uri, context, read)
  const roles = new Set(role ? [role] : records(selected.payload).map(roleOf))
  const history: (typeof selected)[] = []
  try {
    const seen = new Set<number>()
    const unavailable: string[] = []
    let reportBytes = 0
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
        const actor = z.object({login: z.string(), type: z.string()}).safeParse(raw.user)
        if (!actor.success || actor.data.login !== 'factory-droid[bot]' || actor.data.type !== 'Bot') continue
        if (typeof raw.commit_id !== 'string') throw new Error('Malformed provider review revision')
        if (raw.commit_id !== context.head_sha) continue
        if (raw.state === 'PENDING') {
          if (raw.id > selected.review.id) unavailable.push('A newer independent provider review is pending')
          continue
        }
        if (typeof raw.body === 'string') reportBytes += Buffer.byteLength(raw.body)
        if (reportBytes > MAX_EVIDENCE_BYTES) throw new Error('Current provider review history oversized')
        const time = z.iso.datetime({offset: true}).parse(raw.submitted_at)
        const later =
          Date.parse(time) > Date.parse(selected.review.submitted_at) ||
          (Date.parse(time) === Date.parse(selected.review.submitted_at) && raw.id > selected.review.id)
        try {
          // Another integrated revision cannot supersede this exact merge.
          const blocks =
            typeof raw.body === 'string' ? [...raw.body.matchAll(/```forge-evidence-v1\n([\s\S]*?)\n```/g)] : []
          if (blocks.length === 1) {
            const shape = producerPayload.parse(JSON.parse(blocks[0][1]))
            if (records(shape).length && records(shape).every((record) => record.tested_sha !== context.tested_sha))
              continue
          }
          history.push(authenticateReview(raw, context))
        } catch (error) {
          if (raw.id === selected.review.id || later) unavailable.push(String(error))
        }
      }
      if (reviews.length < 100) {
        complete = true
        break
      }
    }
    if (!complete) throw new Error('Provider review pagination limit exceeded')
    const listed = history.find((source) => source.review.id === selected.review.id)
    if (!listed || JSON.stringify(listed.review) !== JSON.stringify(selected.review))
      throw new Error('Selected provider review missing or changed in current listing')
    const {latest, open} = historyState(history, roles)
    const selectedOpen = new Set(
      selected.payload.reviews.flatMap((record) =>
        record.findings
          .filter((f) => f.severity === 'blocking' && f.status === 'open')
          .map((f) => `${record.role}/${f.id}`),
      ),
    )
    const omitted = [...open.values()].filter((finding) => !selectedOpen.has(finding.subject))
    if (omitted.length) throw new ProducerBlockers(omitted)
    if (unavailable.length) throw new Error(`Current provider review unavailable: ${unavailable.join('; ')}`)
    if ([...roles].some((currentRole) => latest.get(currentRole) !== selected.review.id))
      throw new Error('Selected producer verdict is superseded by a later exact-revision review')
    return selected.payload
  } catch (error) {
    if (error instanceof ProducerBlockers) throw error
    // Incomplete history cannot erase failures already proved by the independent app.
    const {open} = historyState(
      [selected, ...history.filter((source) => source.review.id !== selected.review.id)],
      roles,
    )
    if (open.size) throw new ProducerBlockers([...open.values()], error)
    throw error
  }
}
