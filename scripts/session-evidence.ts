import {createHash} from 'node:crypto'
import {readdir, readFile, stat} from 'node:fs/promises'
import {homedir} from 'node:os'
import {join} from 'node:path'

import {z} from 'zod'

import {createConfinement} from '../src/infrastructure/fs/confinement'
import type {ReviewEvidence, VerifierEvidence} from './evidence-schema'
import {reviewSchema, verifierSchema} from './evidence-schema'

export const producerPayload = z
  .object({
    raw_report_markdown: z
      .string()
      .min(1)
      .max(256 * 1024),
    reviews: z.array(reviewSchema).max(2),
    verifier: verifierSchema.nullable(),
  })
  .strict()
interface SessionRecord {
  type: string
  id?: string
  owner?: string
  callingSessionId?: string
  callingToolUseId?: string
  reason?: string
  timestamp?: string
  message?: {
    role?: string
    content?: {type: string; text?: string; id?: string; name?: string; input?: {subagent_type?: string}}[]
  }
}
export async function sessionProducer(uri: string, sessionRoot = join(homedir(), '.factory/sessions')) {
  const match = /^factory-session:\/\/([a-f0-9-]{36})\/([a-f0-9-]{36})$/.exec(uri)
  if (!match || match[1] === match[2]) throw new Error('Invalid independent session reference')
  const boundary = await createConfinement(sessionRoot)
  async function records(id: string): Promise<SessionRecord[]> {
    const candidates: string[] = []
    for (const directory of await readdir(boundary.root, {withFileTypes: true})) {
      if (!directory.isDirectory() || directory.isSymbolicLink()) continue
      const candidate = await boundary.resolve(join(directory.name, `${id}.jsonl`))
      try {
        if ((await stat(candidate)).isFile()) candidates.push(candidate)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }
    if (candidates.length !== 1 || (await stat(candidates[0])).size > 64 * 1024 * 1024)
      throw new Error('Missing/ambiguous/oversized provider session')
    return (await readFile(candidates[0], 'utf8'))
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
  }
  const [parent, child] = await Promise.all([records(match[1]), records(match[2])])
  const metadata = child[0]
  if (metadata.type !== 'session_start' || metadata.id !== match[2] || metadata.callingSessionId !== match[1])
    throw new Error('Provider session ancestry mismatch')
  const task = parent
    .flatMap((record) => (record.message?.role === 'assistant' ? (record.message.content ?? []) : []))
    .find((block) => block.type === 'tool_use' && block.id === metadata.callingToolUseId && block.name === 'Task')
  const role = task?.input?.subagent_type
  if (!['code-reviewer', 'verifier'].includes(role ?? ''))
    throw new Error('Producer was not an independent reviewer/verifier Task')
  const final = child.findLast((record) => record.type === 'message' && record.message?.role === 'assistant')
  const terminal = child.findLast((record) => record.type === 'agent_turn_outcome')
  if (terminal?.reason !== 'completed' || child.indexOf(terminal) < child.indexOf(final!))
    throw new Error('Producer has not completed')
  const text =
    final?.message?.content
      ?.filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n') ?? ''
  const blocks = [...text.matchAll(/```forge-evidence-v1\n([\s\S]*?)\n```/g)]
  if (blocks.length !== 1)
    throw new Error(
      'Completed producer supplied no unique structured attestation; Markdown is supporting evidence only',
    )
  const payload = producerPayload.parse(JSON.parse(blocks[0][1]))
  const hash = createHash('sha256').update(payload.raw_report_markdown).digest('hex')
  const attestations: (ReviewEvidence | VerifierEvidence)[] = [
    ...payload.reviews,
    ...(payload.verifier ? [payload.verifier] : []),
  ]
  if (
    !attestations.length ||
    (role === 'verifier' ? payload.reviews.length || !payload.verifier : payload.verifier !== null)
  )
    throw new Error('Producer role does not match attestation')
  for (const record of attestations) {
    const provenance = record.provenance
    if (
      provenance.actor !== metadata.owner ||
      provenance.producer_id !== metadata.id ||
      provenance.source_uri !== uri ||
      provenance.report_sha256 !== hash
    )
      throw new Error('Spoofed producer identity/report hash')
    const completed = Date.parse(provenance.completed_at)
    const started = child.find((record) => record.timestamp)?.timestamp
    if (
      !started ||
      !final?.timestamp ||
      completed < Date.parse(started) ||
      completed > Date.parse(final.timestamp) + 5000
    )
      throw new Error('Producer completion timestamp mismatch')
    if ('role' in record && record.role !== provenance.producer_role) throw new Error('Review producer role mismatch')
    if ('phase' in record && provenance.producer_role !== 'verifier') throw new Error('Verifier producer role mismatch')
  }
  return payload
}
