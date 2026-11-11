import {z} from 'zod'

import type {EvidenceContext} from './evidence-schema'

export const providerJob = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  status: z.string(),
  conclusion: z.string().nullable(),
  started_at: z.unknown().optional(),
  completed_at: z.unknown().optional(),
})
export const providerArtifact = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  expired: z.boolean(),
  created_at: z.unknown().optional(),
})

const providerTimestamp = z.iso.datetime({offset: true})
/** GitHub's jobs API can keep reporting a finished job as in_progress after recording its conclusion and end time. */
export function providerJobFinished(
  job: Pick<z.infer<typeof providerJob>, 'status' | 'conclusion' | 'completed_at'>,
): boolean {
  return (
    job.status === 'completed' || (job.conclusion !== null && providerTimestamp.safeParse(job.completed_at).success)
  )
}
/** Validate temporal provenance per selected row, preserving unrelated job outcomes. */
export function providerArtifactInJobWindow(
  artifact: z.infer<typeof providerArtifact>,
  job: z.infer<typeof providerJob>,
): boolean {
  const dates = [artifact.created_at, job.started_at, job.completed_at].map((value) => {
    const parsed = providerTimestamp.safeParse(value)
    return parsed.success ? Date.parse(parsed.data) : Number.NaN
  })
  const [created, started, completed] = dates
  return dates.every(Number.isFinite) && started <= created && created <= completed
}

/** Enumerate retained attempts before selecting this attempt's artifacts. */
export async function providerArtifacts(context: EvidenceContext, read = githubJSON) {
  const selected: z.infer<ReturnType<typeof providerArtifact.passthrough>>[] = []
  const seen = new Set<number>()
  let total: number | undefined
  let listed = 0
  for (let page = 1; page <= 100; page++) {
    const response = z
      .object({
        total_count: z.number().int().min(0).max(10000),
        artifacts: z.array(providerArtifact.passthrough()).max(100),
      })
      .parse(
        await read(
          context,
          `/actions/runs/${context.run_id}/artifacts?per_page=100${page === 1 ? '' : `&page=${page}`}`,
        ),
      )
    if (total !== undefined && response.total_count !== total) throw new Error('Provider artifact listing changed')
    total = response.total_count
    for (const artifact of response.artifacts) {
      if (seen.has(artifact.id)) throw new Error('Duplicate provider artifact page entry')
      seen.add(artifact.id)
      if (artifact.name.startsWith(`validation-${context.run_id}-${context.run_attempt}-`)) selected.push(artifact)
    }
    listed += response.artifacts.length
    if (listed === total) return selected
    if (listed > total || response.artifacts.length !== 100) throw new Error('Incomplete provider artifact listing')
  }
  throw new Error('Provider artifact pagination limit exceeded')
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
