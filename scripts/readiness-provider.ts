import {z} from 'zod'

import {hashContent} from '../src/domain/sync/state'
import {artifactFiles} from './artifact-archive'
import {readEvidence} from './evidence-io'
import type {EvidenceContext} from './evidence-schema'
import {contextSchema, evidencePath, laneSchema} from './evidence-schema'
import {artifactName} from './gate'
import {currentPullRequest, githubJSON, providerArtifact, providerJob, requiredCIWorkflow} from './github-evidence'
import {providerProducer} from './producer-evidence'
import type {ReadinessProvider} from './readiness'
import {actualHead} from './validation-context'
import {checkEvidencePath} from './validation-evidence'
import {laneById} from './validation-lanes'

const jobSchema = providerJob
const artifactSchema = providerArtifact.extend({
  digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  workflow_run: z.object({id: z.number().int()}),
})
async function archive(context: EvidenceContext, id: number, digest: string) {
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN
  const response = await fetch(`https://api.github.com/repos/${context.repository}/actions/artifacts/${id}/zip`, {
    headers: {...(token ? {Authorization: `Bearer ${token}`} : {}), Accept: 'application/vnd.github+json'},
    redirect: 'manual',
    signal: AbortSignal.timeout(15000),
  })
  let download = response
  if (response.status === 302) {
    const location = new URL(response.headers.get('location') ?? '')
    if (
      location.protocol !== 'https:' ||
      !location.hostname.endsWith('.blob.core.windows.net') ||
      location.username ||
      location.password ||
      location.port
    )
      throw new Error('Untrusted provider artifact redirect')
    // The signed provider redirect gets no GitHub Authorization header.
    download = await fetch(location, {redirect: 'error', signal: AbortSignal.timeout(15000)})
  }
  if (!download.ok || !download.body) throw new Error('Provider artifact unavailable')
  const reader = download.body.getReader(),
    chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const {done, value} = await reader.read()
      if (done) break
      size += value.length
      if (size > 10 * 1024 * 1024) throw new Error('Provider archive oversized')
      chunks.push(value)
    }
  } finally {
    await reader.cancel()
    reader.releaseLock()
  }
  const bytes = Buffer.concat(chunks)
  if (`sha256:${hashContent(bytes)}` !== digest) throw new Error('Provider artifact digest mismatch')
  return artifactFiles(bytes)
}
export function readinessProvider(
  root: string,
  evidenceRoot: string,
  ports = {githubJSON, archive},
): ReadinessProvider {
  const sessions = new Map<string, ReturnType<typeof providerProducer>>()
  const source = (uri: string, context: EvidenceContext) => {
    if (!sessions.has(uri)) sessions.set(uri, providerProducer(uri, context, ports.githubJSON))
    return sessions.get(uri)!
  }
  const runs = new Map<
    string,
    Promise<{jobs: z.infer<typeof jobSchema>[]; artifacts: z.infer<typeof artifactSchema>[]}>
  >()
  const archives = new Map<number, ReturnType<typeof archive>>()
  const selected = (context: EvidenceContext) => {
    const key = `${context.repository}/${context.run_id}/${context.run_attempt}`
    if (!runs.has(key))
      runs.set(
        key,
        (async () => {
          if (!/^\d+$/.test(context.run_id)) throw new Error('Local evidence has no authenticated native CI run')
          const [run, jobs, artifacts, workflow] = await Promise.all([
            ports.githubJSON(context, `/actions/runs/${context.run_id}/attempts/${context.run_attempt}`),
            ports.githubJSON(
              context,
              `/actions/runs/${context.run_id}/attempts/${context.run_attempt}/jobs?per_page=100`,
            ),
            ports.githubJSON(context, `/actions/runs/${context.run_id}/artifacts?per_page=100`),
            requiredCIWorkflow(context, ports.githubJSON),
          ])
          const identity = z
            .object({
              id: z.number().int().positive(),
              run_attempt: z.number().int().positive(),
              head_sha: z.string(),
              path: z.string(),
              workflow_id: z.number().int().positive(),
            })
            .parse(run)
          if (
            String(identity.id) !== context.run_id ||
            identity.run_attempt !== context.run_attempt ||
            identity.workflow_id !== workflow.id ||
            identity.path !== workflow.path ||
            ![context.head_sha, context.tested_sha].includes(identity.head_sha) ||
            (context.kind === 'pr'
              ? context.workflow_ref !== `${context.repository}/${workflow.path}@refs/pull/${context.pr_number}/merge`
              : !context.workflow_ref?.startsWith(`${context.repository}/${workflow.path}@`))
          )
            throw new Error('Provider workflow identity mismatch')
          return {
            jobs: z.object({total_count: z.number().max(100), jobs: z.array(jobSchema)}).parse(jobs).jobs,
            artifacts: z.object({total_count: z.number().max(100), artifacts: z.array(artifactSchema)}).parse(artifacts)
              .artifacts,
          }
        })(),
      )
    return runs.get(key)!
  }
  const provider: ReadinessProvider = {
    async context(context) {
      if (actualHead(root) !== context.tested_sha) throw new Error('Bundle does not match the actual tested checkout')
      const clean = Bun.spawnSync(['git', '-C', root, 'diff', '--quiet', 'HEAD', '--'], {
        stdout: 'pipe',
        stderr: 'pipe',
      })
      if (clean.exitCode !== 0) throw new Error('Tracked checkout differs from its attested revision')
      if (context.kind === 'pr') {
        const result = Bun.spawnSync(['git', '-C', root, 'cat-file', '-p', context.tested_sha], {
          stdout: 'pipe',
          stderr: 'pipe',
        })
        const parents = new TextDecoder()
          .decode(result.stdout)
          .split('\n')
          .filter((line) => line.startsWith('parent '))
          .map((line) => line.slice(7))
        if (
          result.exitCode !== 0 ||
          parents.length !== 2 ||
          parents[0] !== context.base_sha ||
          parents[1] !== context.head_sha
        )
          throw new Error('Tested merge parents differ from the selected PR/base')
        await selected(context)
        await currentPullRequest(context, ports.githubJSON)
      }
    },
    async artifact(ref, context, citingLane) {
      if (ref.startsWith('factory-session://') || ref.startsWith('https://')) {
        if (citingLane) throw new Error('A producer report cannot substitute for a lane check artifact')
        const payload = await source(ref, context)
        if (
          ![...payload.reviews, ...(payload.verifier ? [payload.verifier] : [])].some(
            (record) => record.head_sha === context.head_sha && record.tested_sha === context.tested_sha,
          )
        )
          throw new Error('Evidence session attests a different revision')
        return
      }
      evidencePath.parse(ref)
      const parts = ref.split('/')
      if (parts.length !== 3 || parts[0] !== 'checks')
        throw new Error('Evidence is not a selected-run lane artifact or authenticated producer')
      const lane = laneById(parts[1])
      if (
        citingLane &&
        (citingLane.lane_id !== lane.id ||
          !citingLane.checks.some((check) => ref === checkEvidencePath(lane.id, check.id)))
      )
        throw new Error('Artifact is not owned by the citing lane/check')
      if (!lane.checks.some((check) => ref === checkEvidencePath(lane.id, check.id)))
        throw new Error('Unknown check artifact')
      const {jobs, artifacts} = await selected(context)
      const job = jobs.filter((job) => job.name === lane.id),
        artifact = artifacts.filter((artifact) => artifact.name === artifactName(context, lane.id))
      if (
        job.length !== 1 ||
        job[0].status !== 'completed' ||
        !['success', 'failure', 'cancelled', 'timed_out'].includes(job[0].conclusion ?? '') ||
        artifact.length !== 1 ||
        artifact[0].expired ||
        artifact[0].workflow_run.id !== Number(context.run_id)
      )
        throw new Error('Artifact origin unavailable or mismatched')
      if (
        !job[0].started_at ||
        !job[0].completed_at ||
        Date.parse(artifact[0].created_at) < Date.parse(job[0].started_at) ||
        Date.parse(artifact[0].created_at) > Date.parse(job[0].completed_at)
      )
        throw new Error('Artifact run-attempt/job window mismatch')
      if (!archives.has(artifact[0].id))
        archives.set(artifact[0].id, ports.archive(context, artifact[0].id, artifact[0].digest))
      const files = await archives.get(artifact[0].id)!
      const originalLaneBytes = files.get(`${lane.id}.json`)
      if (!originalLaneBytes) throw new Error('Authenticated lane verdict missing')
      const originalLane = laneSchema.parse(JSON.parse(originalLaneBytes.toString()))
      if (originalLane.lane_id !== lane.id || (job[0].conclusion !== 'success' && originalLane.status === 'pass'))
        throw new Error('Provider job cannot authenticate a passing lane verdict')
      if (citingLane && JSON.stringify(originalLane) !== JSON.stringify(citingLane))
        throw new Error('Lane verdict differs from the authenticated provider artifact')
      const originalContext = files.get('context.json')
      if (
        !originalContext ||
        JSON.stringify(contextSchema.parse(JSON.parse(originalContext.toString()))) !== JSON.stringify(context)
      )
        throw new Error('Authenticated artifact context is stale/mixed')
      const original = files.get(ref)
      if (!original || !original.length || !original.equals(Buffer.from(await readEvidence(evidenceRoot, ref))))
        throw new Error('Local artifact differs from authenticated provider bytes')
    },
    async producer(record, context) {
      const payload = await source(record.provenance.source_uri, context)
      const records = [...payload.reviews, ...(payload.verifier ? [payload.verifier] : [])]
      if (
        !records.some(
          (item) =>
            item.head_sha === context.head_sha &&
            item.tested_sha === context.tested_sha &&
            JSON.stringify(item) === JSON.stringify(record),
        )
      )
        throw new Error('Sidecar is not the independent producer’s exact structured verdict')
    },
    async gate(record, context) {
      const {jobs} = await selected(context)
      const gate = jobs.filter((job) => job.name === 'Deterministic gate')
      if (
        gate.length !== 1 ||
        gate[0].status !== 'completed' ||
        gate[0].conclusion !== record.conclusion ||
        String(gate[0].id) !== record.provider_id ||
        record.source_uri !==
          `https://github.com/${context.repository}/actions/runs/${context.run_id}/job/${gate[0].id}`
      )
        throw new Error('Gate provider identity/conclusion mismatch')
    },
    async deviation(record, context) {
      const uri = new URL(record.approval.source_uri)
      const prefix = `/${context.repository}/`
      if (context.kind !== 'pr' || uri.origin !== 'https://github.com' || !uri.pathname.startsWith(prefix))
        throw new Error('Approval is not on the selected PR')
      const comment = /^#issuecomment-(\d+)$/.exec(uri.hash),
        review = /^#pullrequestreview-(\d+)$/.exec(uri.hash)
      if (
        !(
          comment &&
          [`${prefix}issues/${context.pr_number}`, `${prefix}pull/${context.pr_number}`].includes(uri.pathname)
        ) &&
        !(review && uri.pathname === `${prefix}pull/${context.pr_number}`)
      )
        throw new Error('Unsupported deviation approval object')
      const endpoint = comment ? `/issues/comments/${comment[1]}` : `/pulls/${context.pr_number}/reviews/${review![1]}`
      const original = z
        .object({
          user: z.object({login: z.literal('NazarUsik')}),
          body: z.string(),
          created_at: z.string().optional(),
          submitted_at: z.string().optional(),
          issue_url: z.string().optional(),
        })
        .parse(await ports.githubJSON(context, endpoint))
      if (original.issue_url && !original.issue_url.endsWith(`/issues/${context.pr_number}`))
        throw new Error('Approval comment belongs to another issue')
      const timestamp = original.submitted_at ?? original.created_at
      if (record.approval.actor !== 'NazarUsik' || record.approval.approved_at !== timestamp)
        throw new Error('Owner approval actor/timestamp mismatch')
      const blocks = [...original.body.matchAll(/```forge-deviation-v1\n([\s\S]*?)\n```/g)]
      if (blocks.length !== 1) throw new Error('Owner did not explicitly approve the exact deviation')
      const approval = z
        .object({
          decision: z.literal('approved'),
          id: z.string(),
          contract_diff_sha256: z.string(),
          head_sha: z.string(),
          tested_sha: z.string(),
        })
        .strict()
        .parse(JSON.parse(blocks[0][1]))
      if (
        approval.id !== record.id ||
        approval.contract_diff_sha256 !== record.contract_diff_sha256 ||
        approval.head_sha !== context.head_sha ||
        approval.tested_sha !== context.tested_sha
      )
        throw new Error('Owner approval hash/revision mismatch')
    },
  }
  return provider
}
