import {mkdir, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {expect, it} from 'bun:test'

import type {DeviationEvidence} from './evidence-schema'
import {sourceUri} from './evidence-schema'
import {readinessFixture} from './fixtures/readiness'
import {providerArtifact, providerJob} from './github-evidence'
import {readinessProvider} from './readiness-provider'

const dir = useTmpDir('provider-artifact')
it.each([
  'e2e',
  'paginated',
  'paginated-missing',
  'paginated-duplicate',
  'paginated-unavailable',
  'paginated-malformed',
  'failed-evidence',
  'blocked-evidence',
  'cancelled-evidence',
  'timed-out-evidence',
  'cancelled-pass',
  'timed-out-pass',
  'unknown-job',
  'running-job',
  'zero-artifact',
  'stale-tested',
  'mixed-attempt',
  'missing',
  'edited',
  'edited-lane',
  'cross-lane',
  'failed-job',
  'foreign-workflow',
  'wrong-workflow-id',
  'missing-workflow-id',
  'workflow-metadata-unavailable',
  'workflow-metadata-path',
  'workflow-reference',
])('production artifact provider accepts registry IDs with digits, rejects %s origin/content defects', async (kind) => {
  const bundle = readinessFixture(),
    context = bundle.context,
    original = structuredClone(context)
  if (kind.startsWith('paginated')) context.run_attempt = original.run_attempt = 10
  const lane = bundle.lanes.find((lane) => lane.lane_id === 'e2e')!
  lane.run_attempt = context.run_attempt
  if (['failed-evidence', 'cancelled-evidence', 'blocked-evidence', 'timed-out-evidence'].includes(kind)) {
    lane.status = kind === 'blocked-evidence' ? 'blocked' : 'fail'
    lane.checks[0].exit_code = kind === 'blocked-evidence' ? null : 1
  }
  const ref = 'checks/e2e/test-e2e.log'
  await mkdir(join(dir(), 'checks/e2e'), {recursive: true})
  await writeFile(join(dir(), ref), kind === 'edited' ? 'forged check data' : 'original selected-run check data')
  if (kind === 'stale-tested') original.tested_sha = 'f'.repeat(40)
  if (kind === 'mixed-attempt') original.run_attempt = 2
  if (kind === 'foreign-workflow') {
    context.workflow_ref = `${context.repository}/.github/workflows/fabricated.yml@refs/pull/99/merge`
    original.workflow_ref = context.workflow_ref
  }
  if (kind === 'workflow-reference') {
    context.workflow_ref = `${context.repository}/.github/workflows/ci.yml@refs/heads/other`
    original.workflow_ref = context.workflow_ref
  }
  const files = new Map([
    ['context.json', Buffer.from(JSON.stringify(original))],
    [ref, Buffer.from('original selected-run check data')],
    ['e2e.json', Buffer.from(JSON.stringify(lane))],
  ])
  if (kind === 'edited-lane') lane.duration_ms++
  if (kind === 'missing') files.delete(ref)
  let archives = 0
  const provider = readinessProvider(dir(), {
    archive: async () => {
      archives++
      return files
    },
    githubJSON: async (_context, endpoint) => {
      if (endpoint === '/actions/workflows/ci.yml') {
        if (kind === 'workflow-metadata-unavailable') throw new Error('Workflow metadata unavailable')
        return {
          id: 7,
          path: kind === 'workflow-metadata-path' ? '.github/workflows/fabricated.yml' : '.github/workflows/ci.yml',
        }
      }
      if (endpoint.endsWith('/jobs?per_page=100'))
        return {
          total_count: 1,
          jobs: [
            {
              id: 1,
              name: 'e2e',
              status: kind === 'running-job' ? 'in_progress' : 'completed',
              conclusion: ['cancelled-evidence', 'cancelled-pass'].includes(kind)
                ? 'cancelled'
                : ['timed-out-evidence', 'timed-out-pass'].includes(kind)
                  ? 'timed_out'
                  : kind === 'unknown-job'
                    ? 'neutral'
                    : ['failed-job', 'failed-evidence', 'blocked-evidence'].includes(kind)
                      ? 'failure'
                      : 'success',
              started_at: '2026-11-04T12:00:00Z',
              completed_at: '2026-11-04T12:01:00Z',
            },
          ],
        }
      if (endpoint.includes('/artifacts?per_page=100')) {
        if (kind.startsWith('paginated') && !endpoint.includes('&page='))
          return {
            total_count: kind === 'paginated-missing' ? 100 : kind === 'paginated-duplicate' ? 102 : 101,
            artifacts: Array.from({length: 100}, (_, index) => ({
              id: 1000 + index,
              name: `validation-123-9-history-${index}`,
              expired: false,
              created_at: '2026-11-04T11:00:00Z',
            })),
          }
        if (kind === 'paginated-unavailable') throw new Error('Later artifact page unavailable')
        if (kind === 'paginated-malformed') return {total_count: 101, artifacts: [{}]}
        const artifact = {
          id: kind === 'zero-artifact' ? 0 : 2,
          name: `validation-123-${context.run_attempt}-e2e`,
          expired: false,
          created_at: '2026-11-04T12:00:30Z',
          digest: `sha256:${'d'.repeat(64)}`,
          workflow_run: {id: 123},
        }
        return {
          total_count: kind.startsWith('paginated') ? (kind === 'paginated-duplicate' ? 102 : 101) : 1,
          artifacts: kind === 'paginated-duplicate' ? [artifact, {...artifact, id: 3}] : [artifact],
        }
      }
      return {
        id: 123,
        run_attempt: context.run_attempt,
        head_sha: context.tested_sha,
        workflow_id:
          kind === 'missing-workflow-id'
            ? undefined
            : kind === 'wrong-workflow-id' || kind === 'foreign-workflow'
              ? 8
              : 7,
        path: kind === 'foreign-workflow' ? '.github/workflows/fabricated.yml' : '.github/workflows/ci.yml',
      }
    },
  })
  const citing = kind === 'cross-lane' ? bundle.lanes.find((lane) => lane.lane_id === 'security')! : lane
  if (
    ['e2e', 'paginated', 'failed-evidence', 'blocked-evidence', 'cancelled-evidence', 'timed-out-evidence'].includes(
      kind,
    )
  )
    await expect(provider.artifact(ref, context, citing)).resolves.toBeUndefined()
  else await expect(provider.artifact(ref, context, citing)).rejects.toThrow()
  if (kind.includes('workflow')) expect(archives).toBe(0)
  await expect(provider.artifact(bundle.reviews[0].provenance.source_uri, context, lane)).rejects.toThrow(
    'cannot substitute',
  )
  for (const invalid of ['checks/e2e/not-a-check.log', 'checks/../test-e2e.log', 'checks/unknown/test-e2e.log'])
    await expect(provider.artifact(invalid, context)).rejects.toThrow()
})
it.each([
  'exact',
  'pr-comment',
  'issue-comment',
  'wrong-owner',
  'wrong-revision',
  'wrong-fragment',
  'wrong-hash',
  'wrong-timestamp',
])('AC-32 authenticates the actual owner review approval URI: %s', async (kind) => {
  const context = readinessFixture().context
  const record: DeviationEvidence = {
    schema_version: 1,
    id: 'D1',
    description: 'synthetic approval only',
    ac_ids: ['AC-26'],
    contract_diff_sha256: 'd'.repeat(64),
    head_sha: context.head_sha,
    tested_sha: context.tested_sha,
    approval: {
      decision: 'approved',
      actor: 'NazarUsik',
      source_uri: `https://github.com/${context.repository}/pull/99#pullrequestreview${kind === 'wrong-fragment' ? '' : '-'}777`,
      approved_at: '2026-11-04T12:00:00Z',
    },
  }
  const comment = kind === 'pr-comment' || kind === 'issue-comment'
  if (comment)
    record.approval.source_uri = `https://github.com/${context.repository}/${kind === 'pr-comment' ? 'pull' : 'issues'}/99#issuecomment-777`
  if (kind !== 'wrong-fragment') expect(sourceUri.safeParse(record.approval.source_uri).success).toBe(true)
  let calls = 0
  const provider = readinessProvider(dir(), {
    archive: async () => new Map(),
    githubJSON: async (_context, endpoint) => {
      calls++
      expect(endpoint).toBe(comment ? '/issues/comments/777' : '/pulls/99/reviews/777')
      return {
        user: {login: kind === 'wrong-owner' ? 'not-owner' : 'NazarUsik'},
        submitted_at: kind === 'wrong-timestamp' ? '2026-11-03T12:00:00Z' : record.approval.approved_at,
        body:
          '```forge-deviation-v1\n' +
          JSON.stringify({
            decision: 'approved',
            id: record.id,
            contract_diff_sha256: kind === 'wrong-hash' ? 'e'.repeat(64) : record.contract_diff_sha256,
            head_sha: context.head_sha,
            tested_sha: kind === 'wrong-revision' ? 'f'.repeat(40) : context.tested_sha,
          }) +
          '\n```',
      }
    },
  })
  if (['exact', 'pr-comment', 'issue-comment'].includes(kind))
    await expect(provider.deviation(record, context)).resolves.toBeUndefined()
  else await expect(provider.deviation(record, context)).rejects.toThrow()
  expect(calls).toBe(kind === 'wrong-fragment' ? 0 : 1)
})
it('AC-25 shared provider jobs reject non-positive IDs consistently', () => {
  const job = {id: 1, name: 'quality', status: 'completed', conclusion: 'success', started_at: null, completed_at: null}
  expect(providerJob.safeParse(job).success).toBe(true)
  for (const id of [0, -1, 1.5]) expect(providerJob.safeParse({...job, id}).success).toBe(false)
})
it('AC-25 shared provider artifacts reject non-positive IDs consistently', () => {
  const artifact = {id: 1, name: 'quality', expired: false, created_at: '2026-11-04T12:00:00Z'}
  expect(providerArtifact.safeParse(artifact).success).toBe(true)
  for (const id of [0, -1, 1.5]) expect(providerArtifact.safeParse({...artifact, id}).success).toBe(false)
})
