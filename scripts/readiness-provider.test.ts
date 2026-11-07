import {mkdir, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {expect, it} from 'bun:test'

import type {DeviationEvidence} from './evidence-schema'
import {sourceUri} from './evidence-schema'
import {producerFixture} from './fixtures/producer'
import {readinessFixture} from './fixtures/readiness'
import {providerArtifact, providerArtifactInJobWindow, providerJob} from './github-evidence'
import {readiness} from './readiness'
import {readinessProvider} from './readiness-provider'

const dir = useTmpDir('provider-artifact')
const windowJob = {
  id: 1,
  name: 'e2e',
  status: 'completed',
  conclusion: 'success',
  started_at: '2026-11-04T12:00:00Z',
  completed_at: '2026-11-04T12:01:00Z',
}
const windowArtifact = {id: 2, name: 'e2e', expired: false, created_at: '2026-11-04T12:00:30Z'}
it.each([undefined, null, 0, {}, [], true].map((value) => ({value})))(
  'AC-25,27,32 missing/wrong-type window timestamp rejects %j',
  ({value}) => {
    expect(providerArtifactInJobWindow({...windowArtifact, created_at: value}, windowJob)).toBe(false)
    expect(providerArtifactInJobWindow(windowArtifact, {...windowJob, started_at: value})).toBe(false)
    expect(providerArtifactInJobWindow(windowArtifact, {...windowJob, completed_at: value})).toBe(false)
  },
)
it.each(['artifact', 'start', 'end'].flatMap((field) => ['missing', 'typed', 'null'].map((kind) => ({field, kind}))))(
  'AC-25,27,32 actual provider preserves valid sibling when $field is $kind',
  async ({field, kind}) => {
    const bundle = readinessFixture(),
      context = bundle.context
    const good = bundle.lanes.find((lane) => lane.lane_id === 'e2e')!
    const bad = bundle.lanes.find((lane) => lane.lane_id === 'quality')!
    const ref = 'checks/e2e/test-e2e.log'
    good.checks[0].evidence = [ref]
    const badRef = `checks/quality/${bad.checks[0].id.replaceAll(':', '-')}.log`
    bad.checks[0].evidence = [badRef]
    await mkdir(join(dir(), 'checks/e2e'), {recursive: true})
    await writeFile(join(dir(), ref), 'original sibling log')
    const files = new Map([
      ['context.json', Buffer.from(JSON.stringify(context))],
      ['e2e.json', Buffer.from(JSON.stringify(good))],
      [ref, Buffer.from('original sibling log')],
    ])
    const jobs = ['quality', 'e2e'].map((name, index) => ({
      id: index + 1,
      name,
      status: 'completed',
      conclusion: 'success',
      started_at: windowJob.started_at,
      completed_at: windowJob.completed_at,
    }))
    const artifacts = ['quality', 'e2e'].map((name, index) => ({
      id: index + 100,
      name: `validation-${context.run_id}-${context.run_attempt}-${name}`,
      expired: false,
      created_at: windowArtifact.created_at,
      digest: `sha256:${'d'.repeat(64)}`,
      workflow_run: {id: Number(context.run_id)},
    }))
    const target = field === 'artifact' ? artifacts[0] : jobs[0]
    const key = field === 'artifact' ? 'created_at' : field === 'start' ? 'started_at' : 'completed_at'
    if (kind === 'missing') Reflect.deleteProperty(target, key)
    else Reflect.set(target, key, kind === 'null' ? null : {invalid: 'timestamp'})
    let archives = 0
    const provider = readinessProvider(dir(), {
      archive: async () => {
        archives++
        return files
      },
      githubJSON: async (_context, endpoint) => {
        if (endpoint.includes('/jobs?')) return {total_count: jobs.length, jobs}
        if (endpoint.includes('/artifacts?')) return {total_count: artifacts.length, artifacts}
        if (endpoint === '/actions/workflows/ci.yml') return {id: 7, path: '.github/workflows/ci.yml'}
        return {
          id: Number(context.run_id),
          run_attempt: context.run_attempt,
          head_sha: context.tested_sha,
          workflow_id: 7,
          path: '.github/workflows/ci.yml',
        }
      },
    })
    await expect(provider.artifact(ref, context, good)).resolves.toBeUndefined()
    await expect(provider.artifact(badRef, context, bad)).rejects.toThrow('window mismatch')
    expect(archives).toBe(1)
  },
)
it.each([
  'not-an-ISO-date',
  'NaN',
  'Infinity',
  '',
  '2026-02-30T12:00:00Z',
  '2026-13-01T12:00:00Z',
  '2026-11-04',
  '2026-11-04T12:00:30',
  '2026-11-04T24:00:00Z',
])('AC-25,27,32 window provenance rejects malformed artifact/start/end timestamp: %s', (value) => {
  expect(providerArtifactInJobWindow({...windowArtifact, created_at: value}, windowJob)).toBe(false)
  expect(providerArtifactInJobWindow(windowArtifact, {...windowJob, started_at: value})).toBe(false)
  expect(providerArtifactInJobWindow(windowArtifact, {...windowJob, completed_at: value})).toBe(false)
})
it.each(['2026-11-04T12:00:00Z', '2026-11-04T12:01:00Z', '2026-11-04T13:00:30.123+01:00'])(
  'AC-25,27,32 finite ordered window accepts valid endpoint/offset timestamp: %s',
  (value) => {
    expect(providerArtifactInJobWindow({...windowArtifact, created_at: value}, windowJob)).toBe(true)
    expect(providerArtifactInJobWindow(windowArtifact, {...windowJob, started_at: null})).toBe(false)
    expect(providerArtifactInJobWindow(windowArtifact, {...windowJob, completed_at: null})).toBe(false)
    expect(providerArtifactInJobWindow(windowArtifact, {...windowJob, completed_at: '2026-11-04T11:00:00Z'})).toBe(
      false,
    )
    expect(providerArtifactInJobWindow({...windowArtifact, created_at: '2026-11-04T12:01:00.001Z'}, windowJob)).toBe(
      false,
    )
  },
)
it.each([
  'e2e',
  'invalid-artifact-time',
  'invalid-job-start',
  'invalid-job-end',
  'reversed-job-window',
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
              started_at:
                kind === 'invalid-job-start'
                  ? 'not-an-ISO-date'
                  : kind === 'reversed-job-window'
                    ? '2026-11-04T12:02:00Z'
                    : '2026-11-04T12:00:00Z',
              completed_at: kind === 'invalid-job-end' ? 'not-an-ISO-date' : '2026-11-04T12:01:00Z',
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
          created_at: kind === 'invalid-artifact-time' ? 'not-an-ISO-date' : '2026-11-04T12:00:30Z',
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
  if (kind.startsWith('invalid-') || kind === 'reversed-job-window') expect(archives).toBe(0)
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
  'dismissed',
  'pending',
  'missing-state',
  'unknown-state',
  'commented-review',
  'changes-requested-review',
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
        state:
          kind === 'dismissed'
            ? 'DISMISSED'
            : kind === 'pending'
              ? 'PENDING'
              : kind === 'missing-state'
                ? undefined
                : kind === 'unknown-state'
                  ? 'WITHDRAWN'
                  : kind === 'commented-review'
                    ? 'COMMENTED'
                    : kind === 'changes-requested-review'
                      ? 'CHANGES_REQUESTED'
                      : 'APPROVED',
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
  if (['exact', 'pr-comment', 'issue-comment', 'commented-review', 'changes-requested-review'].includes(kind))
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
it('AC-32 artifact503 cannot invalidate independently authenticated gate jobs or producer failures', async () => {
  const f = producerFixture(),
    context = f.bundle.context
  f.selected.payload.reviews[0].findings.push({...f.blocker, evidence: [f.selected.uri]})
  f.bundle.reviews = f.selected.payload.reviews
  const read = f.read([f.selected])
  let artifactCalls = 0
  const provider = readinessProvider(dir(), {
    archive: async () => {
      throw Error('No archive should be reached')
    },
    githubJSON: async (selected, endpoint) => {
      if (endpoint.includes('/pulls/')) return read(selected, endpoint)
      if (endpoint === '/actions/workflows/ci.yml') return {id: 7, path: '.github/workflows/ci.yml'}
      if (endpoint.includes('/artifacts?')) {
        artifactCalls++
        throw Error('Synthetic artifact HTTP503')
      }
      if (endpoint.includes('/jobs?'))
        return {
          total_count: 1,
          jobs: [
            {
              ...windowJob,
              id: Number(f.bundle.gate.provider_id),
              name: 'Deterministic gate',
            },
          ],
        }
      return {
        id: Number(context.run_id),
        run_attempt: context.run_attempt,
        head_sha: context.tested_sha,
        workflow_id: 7,
        path: '.github/workflows/ci.yml',
      }
    },
  })
  await expect(provider.gate(f.bundle.gate, context)).resolves.toBeUndefined()
  expect(artifactCalls).toBe(0)
  // Synthetic checkout/PR identity only here; genuine clean-merge CLI controls test production context independently.
  const report = await readiness(f.bundle, Bun.version, {...provider, context: async () => {}})
  expect(report.exit_code).toBe(1)
  expect(report.reasons.some((r) => r.kind === 'failure' && r.subject === `code/${f.blocker.id}`)).toBe(true)
  expect(report.reasons.some((r) => r.kind === 'blocked' && r.message.includes('HTTP503'))).toBe(true)
  expect(artifactCalls).toBe(1)
})
