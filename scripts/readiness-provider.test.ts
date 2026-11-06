import {mkdir, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {expect, it} from 'bun:test'

import {readinessFixture} from './fixtures/readiness'
import {readinessProvider} from './readiness-provider'

const dir = useTmpDir('provider-artifact')
it.each(['e2e', 'stale-tested', 'mixed-attempt', 'missing', 'edited', 'edited-lane', 'cross-lane', 'failed-job'])(
  'production artifact provider accepts registry IDs with digits, rejects %s origin/content defects',
  async (kind) => {
    const bundle = readinessFixture(),
      context = bundle.context,
      original = structuredClone(context)
    const lane = bundle.lanes.find((lane) => lane.lane_id === 'e2e')!
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
                status: 'completed',
                conclusion: kind === 'failed-job' ? 'failure' : 'success',
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
    if (kind === 'e2e') await expect(provider.artifact(ref, context, citing)).resolves.toBeUndefined()
    else await expect(provider.artifact(ref, context, citing)).rejects.toThrow()
    await expect(provider.artifact(bundle.reviews[0].provenance.source_uri, context, lane)).rejects.toThrow(
      'cannot substitute',
    )
    for (const invalid of ['checks/e2e/not-a-check.log', 'checks/../test-e2e.log', 'checks/unknown/test-e2e.log'])
      await expect(provider.artifact(invalid, context)).rejects.toThrow()
  },
)
