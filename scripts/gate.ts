import {readFile} from 'node:fs/promises'
import {resolve} from 'node:path'

import {z} from 'zod'

import {readEvidence, writeEvidence} from './evidence-io'
import type {EvidenceContext} from './evidence-schema'
import {evidencePath} from './evidence-schema'
import {githubJSON} from './github-evidence'
import {repositoryRoot, validationContext} from './validation-context'
import {validationLanes} from './validation-lanes'
import {assessLane} from './validation-policy'

const providerJob = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  status: z.string(),
  conclusion: z.string().nullable(),
  started_at: z.string().nullable(),
  completed_at: z.string().nullable(),
})
const providerArtifact = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  expired: z.boolean(),
  created_at: z.string(),
})
export const artifactName = (context: EvidenceContext, lane: string) =>
  `validation-${context.run_id}-${context.run_attempt}-${lane}`
export async function deterministicGate(
  context: EvidenceContext,
  incoming: string,
  pin: string,
  jobs: z.infer<typeof providerJob>[],
  artifacts: z.infer<typeof providerArtifact>[],
) {
  const rows = []
  for (const definition of validationLanes) {
    let status = 'blocked',
      reason = '',
      evidence: unknown = null
    const job = jobs.filter((job) => job.name === definition.id)
    const artifact = artifacts.filter((artifact) => artifact.name === artifactName(context, definition.id))
    try {
      if (job.length !== 1 || job[0].status !== 'completed' || job[0].conclusion !== 'success')
        throw new Error(`Required provider job ${job[0]?.conclusion ?? 'missing/incomplete'}`)
      if (artifact.length !== 1 || artifact[0].expired)
        throw new Error('Missing/duplicate/expired selected-run artifact')
      if (
        !job[0].started_at ||
        !job[0].completed_at ||
        Date.parse(artifact[0].created_at) < Date.parse(job[0].started_at) ||
        Date.parse(artifact[0].created_at) > Date.parse(job[0].completed_at)
      )
        throw new Error('Artifact is not from the selected job execution window')
      const folder = resolve(incoming, artifactName(context, definition.id))
      const raw = JSON.parse(await readEvidence(folder, `${definition.id}.json`))
      const lane = assessLane(raw, context, pin)
      if (lane.status !== 'pass') throw new Error(`Lane reported ${lane.status}`)
      for (const check of lane.checks)
        for (const ref of check.evidence) {
          evidencePath.parse(ref)
          if (!ref.startsWith(`checks/${definition.id}/`))
            throw new Error('Evidence is not owned by this lane artifact')
          if (!(await readEvidence(folder, ref)).trim()) throw new Error('Empty check evidence')
        }
      status = 'pass'
      evidence = lane
    } catch (error) {
      reason = (error as Error).message
      if (job.some((item) => item.conclusion === 'failure')) status = 'fail'
    }
    rows.push({
      lane_id: definition.id,
      status,
      reason,
      evidence,
      provider_job_id: job[0]?.id ?? null,
      artifact_id: artifact[0]?.id ?? null,
    })
  }
  return {
    schema_version: 1,
    context,
    conclusion: rows.every((row) => row.status === 'pass') ? 'success' : 'failure',
    lanes: rows,
  }
}
if (import.meta.main) {
  try {
    const context = validationContext(repositoryRoot)
    const [jobsRaw, artifactsRaw] = await Promise.all([
      githubJSON(context, `/actions/runs/${context.run_id}/attempts/${context.run_attempt}/jobs?per_page=100`),
      githubJSON(context, `/actions/runs/${context.run_id}/artifacts?per_page=100`),
    ])
    const jobs = z.object({total_count: z.number().max(100), jobs: z.array(providerJob)}).parse(jobsRaw).jobs
    const artifacts = z
      .object({total_count: z.number().max(100), artifacts: z.array(providerArtifact)})
      .parse(artifactsRaw).artifacts
    const result = await deterministicGate(
      context,
      resolve(repositoryRoot, 'results/incoming'),
      (await readFile(resolve(repositoryRoot, '.bun-version'), 'utf8')).trim(),
      jobs,
      artifacts,
    )
    await writeEvidence(resolve(repositoryRoot, 'results/gate-summary.json'), result)
    for (const lane of result.lanes)
      console.log(`${lane.lane_id}: ${lane.status}${lane.reason ? ` (${lane.reason})` : ''}`)
    process.exitCode = result.conclusion === 'success' ? 0 : 1
  } catch {
    for (const lane of validationLanes) console.error(`${lane.id}: blocked, provider/context unavailable`)
    process.exitCode = 1
  }
}
