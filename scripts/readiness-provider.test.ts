import {mkdir, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {expect, it} from 'bun:test'

import type {DeviationEvidence} from './evidence-schema'
import {readinessFixture} from './fixtures/readiness'
import {readinessProvider} from './readiness-provider'

const dir = useTmpDir('provider-artifact')
it.each([
  'e2e',
  'failed-evidence',
  'blocked-evidence',
  'cancelled-evidence',
  'timed-out-evidence',
  'cancelled-pass',
  'timed-out-pass',
  'unknown-job',
  'running-job',
  'stale-tested',
  'mixed-attempt',
  'missing',
  'edited',
  'edited-lane',
  'cross-lane',
  'failed-job',
])('production artifact provider accepts registry IDs with digits, rejects %s origin/content defects', async (kind) => {
  const bundle = readinessFixture(),
    context = bundle.context,
    original = structuredClone(context)
  const lane = bundle.lanes.find((lane) => lane.lane_id === 'e2e')!
  if (['failed-evidence', 'cancelled-evidence', 'blocked-evidence', 'timed-out-evidence'].includes(kind)) {
    lane.status = kind === 'blocked-evidence' ? 'blocked' : 'fail'
    lane.checks[0].exit_code = kind === 'blocked-evidence' ? null : 1
  }
  const ref = 'checks/e2e/test-e2e.log'
  await mkdir(join(dir(), 'checks/e2e'), {recursive: true})
  await writeFile(join(dir(), ref), kind === 'edited' ? 'forged check data' : 'original selected-run check data')
  if (kind === 'stale-tested') original.tested_sha = 'f'.repeat(40)
  if (kind === 'mixed-attempt') original.run_attempt = 2
  const files = new Map([
    ['context.json', Buffer.from(JSON.stringify(original))],
    [ref, Buffer.from('original selected-run check data')],
    ['e2e.json', Buffer.from(JSON.stringify(lane))],
  ])
  if (kind === 'edited-lane') lane.duration_ms++
  if (kind === 'missing') files.delete(ref)
  const provider = readinessProvider(dir(), dir(), {
    archive: async () => files,
    githubJSON: async (_context, endpoint) => {
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
      if (endpoint.endsWith('/artifacts?per_page=100'))
        return {
          total_count: 1,
          artifacts: [
            {
              id: 2,
              name: 'validation-123-1-e2e',
              expired: false,
              created_at: '2026-11-04T12:00:30Z',
              digest: `sha256:${'d'.repeat(64)}`,
              workflow_run: {id: 123},
            },
          ],
        }
      return {id: 123, run_attempt: 1, head_sha: context.tested_sha, path: '.github/workflows/ci.yml'}
    },
  })
  const citing = kind === 'cross-lane' ? bundle.lanes.find((lane) => lane.lane_id === 'security')! : lane
  if (['e2e', 'failed-evidence', 'blocked-evidence', 'cancelled-evidence', 'timed-out-evidence'].includes(kind))
    await expect(provider.artifact(ref, context, citing)).resolves.toBeUndefined()
  else await expect(provider.artifact(ref, context, citing)).rejects.toThrow()
  await expect(provider.artifact(bundle.reviews[0].provenance.source_uri, context, lane)).rejects.toThrow(
    'cannot substitute',
  )
  for (const invalid of ['checks/e2e/not-a-check.log', 'checks/../test-e2e.log', 'checks/unknown/test-e2e.log'])
    await expect(provider.artifact(invalid, context)).rejects.toThrow()
})
it.each(['exact', 'wrong-owner', 'wrong-revision', 'wrong-fragment', 'wrong-hash', 'wrong-timestamp'])(
  'AC-32 authenticates the actual owner review approval URI: %s',
  async (kind) => {
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
    let calls = 0
    const provider = readinessProvider(dir(), dir(), {
      archive: async () => new Map(),
      githubJSON: async (_context, endpoint) => {
        calls++
        expect(endpoint).toBe('/pulls/99/reviews/777')
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
    if (kind === 'exact') await expect(provider.deviation(record, context)).resolves.toBeUndefined()
    else await expect(provider.deviation(record, context)).rejects.toThrow()
    expect(calls).toBe(kind === 'wrong-fragment' ? 0 : 1)
  },
)
