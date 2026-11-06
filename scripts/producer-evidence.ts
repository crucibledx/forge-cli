import {z} from 'zod'

import {hashContent} from '../src/domain/sync/state'
import type {EvidenceContext} from './evidence-schema'
import {githubJSON} from './github-evidence'
import {producerPayload} from './producer-payload'

/** Trust the independently operated review app, never files or an implementer's GitHub comment. */
export async function providerProducer(uri: string, context: EvidenceContext, read = githubJSON) {
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
  const review = z
    .object({
      id: z.number().int().positive(),
      user: z.object({login: z.literal('factory-droid[bot]'), type: z.literal('Bot')}),
      commit_id: z.string(),
      submitted_at: z.string(),
      state: z.enum(['APPROVED', 'COMMENTED', 'CHANGES_REQUESTED']),
      html_url: z.string(),
      body: z.string().max(256 * 1024),
    })
    .parse(await read(context, `/pulls/${context.pr_number}/reviews/${match[1]}`))
  if (String(review.id) !== match[1] || review.commit_id !== context.head_sha || review.html_url !== uri)
    throw new Error('Independent provider review identity/revision mismatch')
  const blocks = [...review.body.matchAll(/```forge-evidence-v1\n([\s\S]*?)\n```/g)]
  if (blocks.length !== 1) throw new Error('Independent provider supplied no unique structured attestation')
  const payload = producerPayload.parse(JSON.parse(blocks[0][1]))
  const hash = hashContent(payload.raw_report_markdown)
  const records = [...payload.reviews, ...(payload.verifier ? [payload.verifier] : [])]
  if (!records.length) throw new Error('Independent provider supplied no verdict')
  for (const record of records) {
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
      !Number.isFinite(submitted) ||
      completed < submitted - 300000 ||
      completed > submitted + 5000 ||
      p.producer_role !== ('role' in record ? record.role : 'verifier')
    )
      throw new Error('Independent provider attestation does not bind its verdict, actor, report and exact revision')
  }
  return payload
}
