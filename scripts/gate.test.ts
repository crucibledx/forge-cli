import {mkdir, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {expect, it} from 'bun:test'

import {writeEvidence} from './evidence-io'
import {readinessFixture} from './fixtures/readiness'
import {artifactName, deterministicGate} from './gate'
import {validationLanes} from './validation-lanes'

const dir = useTmpDir('gate')
it.each([
  'complete',
  'two-failures',
  'missing-artifact',
  'stale-tested',
  'mixed-attempt',
  'cancelled',
  'skipped',
  'expired',
  'malformed',
  'missing-log',
])('AC-25,27 selected provider run rejects %s while reporting every sibling', async (kind) => {
  const bundle = readinessFixture(),
    jobs = [],
    artifacts = []
  for (const [index, definition] of validationLanes.entries()) {
    const folder = join(dir(), artifactName(bundle.context, definition.id))
    await mkdir(join(folder, 'checks', definition.id), {recursive: true})
    const lane = bundle.lanes[index]
    lane.checks.forEach((check) => {
      check.evidence = [`checks/${definition.id}/${check.id.replaceAll(':', '-')}.log`]
    })
    for (const check of lane.checks) await writeFile(join(folder, check.evidence[0]), 'bounded fixture outcome')
    if (index === 0 && kind === 'stale-tested') lane.tested_sha = 'f'.repeat(40)
    if (index === 0 && kind === 'mixed-attempt') lane.run_attempt = 2
    if (index === 0 && kind === 'missing-log') lane.checks[0].evidence = [`checks/${definition.id}/missing.log`]
    await writeEvidence(
      join(folder, `${definition.id}.json`),
      kind === 'malformed' && index === 0 ? {status: 'pass'} : lane,
    )
    jobs.push({
      id: index + 1,
      name: definition.id,
      status: 'completed',
      conclusion:
        kind === 'two-failures' && index < 2
          ? 'failure'
          : index === 0 && ['cancelled', 'skipped'].includes(kind)
            ? kind
            : 'success',
      started_at: '2026-11-04T10:00:00Z',
      completed_at: '2026-11-04T10:01:00Z',
    })
    if (kind !== 'missing-artifact' || index !== 0)
      artifacts.push({
        id: index + 100,
        name: artifactName(bundle.context, definition.id),
        expired: kind === 'expired' && index === 0,
        created_at: '2026-11-04T10:00:30Z',
      })
  }
  const result = await deterministicGate(bundle.context, dir(), Bun.version, jobs, artifacts)
  expect(result.lanes).toHaveLength(10)
  expect(result.conclusion).toBe(kind === 'complete' ? 'success' : 'failure')
  if (kind === 'two-failures') {
    expect(result.lanes.filter((row) => row.status === 'fail')).toHaveLength(2)
    expect(result.lanes.filter((row) => row.status === 'pass')).toHaveLength(8)
  }
})
