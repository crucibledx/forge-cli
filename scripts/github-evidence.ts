import {z} from 'zod'

import type {EvidenceContext} from './evidence-schema'
import {gateSchema} from './evidence-schema'

/** Exact-revision evidence cannot authorize a newer PR head or changed base/merge. */
export async function currentPullRequest(context: EvidenceContext, read = githubJSON) {
  const pr = z
    .object({
      head: z.object({sha: z.string()}),
      base: z.object({sha: z.string()}),
      merge_commit_sha: z.string().nullable(),
    })
    .parse(await read(context, `/pulls/${context.pr_number}`))
  if (
    pr.head.sha !== context.head_sha ||
    pr.base.sha !== context.base_sha ||
    pr.merge_commit_sha !== context.tested_sha
  )
    throw new Error('Evidence does not match the current provider PR head/base/merge')
}

/** Collection obtains the actual selected gate instead of requiring a hand-written gate.json. */
export async function providerGate(context: EvidenceContext, read = githubJSON) {
  const response = z
    .object({
      total_count: z.number().int().max(100),
      jobs: z.array(
        z.object({
          id: z.number().int().positive(),
          name: z.string(),
          status: z.string(),
          conclusion: z.string().nullable(),
        }),
      ),
    })
    .parse(await read(context, `/actions/runs/${context.run_id}/attempts/${context.run_attempt}/jobs?per_page=100`))
  const gates = response.jobs.filter((job) => job.name === 'Deterministic gate')
  if (gates.length !== 1 || gates[0].status !== 'completed')
    throw new Error('Selected provider gate is missing or incomplete')
  const job = gates[0]
  return gateSchema.parse({
    schema_version: 1,
    name: 'Deterministic gate',
    head_sha: context.head_sha,
    tested_sha: context.tested_sha,
    run_id: context.run_id,
    run_attempt: context.run_attempt,
    provider_id: String(job.id),
    conclusion: job.conclusion,
    source_uri: `https://github.com/${context.repository}/actions/runs/${context.run_id}/job/${job.id}`,
  })
}

/** Read-only provider access. Never follow a report's URL with credentials. */
export async function githubJSON(context: EvidenceContext, suffix: string): Promise<unknown> {
  if (!suffix.startsWith('/') || suffix.includes('..')) throw new Error('Invalid provider endpoint')
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN
  const response = await fetch(`https://api.github.com/repos/${context.repository}${suffix}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      ...(token ? {Authorization: `Bearer ${token}`} : {}),
      'X-GitHub-Api-Version': '2022-11-28',
    },
    redirect: 'error',
    signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) throw new Error(`Provider evidence unavailable (HTTP ${response.status})`)
  const length = Number(response.headers.get('content-length'))
  if (length > 2 * 1024 * 1024) throw new Error('Provider response oversized')
  return response.json()
}
