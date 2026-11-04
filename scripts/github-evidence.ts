import type {EvidenceContext} from './evidence-schema'

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
