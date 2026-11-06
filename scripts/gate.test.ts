import {copyFile, mkdir, symlink, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {expect, it} from 'bun:test'

import {SKILL_DEPLOY} from '../e2e/fixtures/sources'
import {createBareRepo} from '../e2e/framework/git'
import {runPipe} from '../e2e/framework/pipe'
import {writeEvidence} from './evidence-io'
import {readinessFixture} from './fixtures/readiness'
import {artifactName, deterministicGate, runGate} from './gate'
import {repositoryRoot} from './validation-context'
import {validationLanes} from './validation-lanes'

const dir = useTmpDir('gate')
async function fixture(kind: string) {
  const bundle = readinessFixture(),
    jobs = [],
    artifacts = []
  if (kind === 'attempt10') {
    bundle.context.run_attempt = 10
    bundle.lanes.forEach((lane) => {
      lane.run_attempt = 10
    })
  }
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
  return {bundle, jobs, artifacts}
}
it.each(['artifact', 'start', 'end', 'reversed'])(
  'AC-25,27,32 malformed timestamp %s blocks only its row and preserves known sibling failure',
  async (kind) => {
    const {bundle, jobs, artifacts} = await fixture('complete')
    if (kind === 'artifact') artifacts[0].created_at = 'not-an-ISO-date'
    if (kind === 'start') jobs[0].started_at = 'not-an-ISO-date'
    if (kind === 'end') jobs[0].completed_at = 'not-an-ISO-date'
    if (kind === 'reversed') jobs[0].started_at = '2026-11-04T10:02:00Z'
    jobs[1].conclusion = 'failure'
    const direct = await deterministicGate(bundle.context, dir(), Bun.version, jobs, artifacts)
    expect(direct.lanes[0].status).toBe('blocked')
    expect(direct.lanes[1].status).toBe('fail')
    expect(direct.lanes.filter((lane) => lane.status === 'pass')).toHaveLength(8)
    const result = await runGate(
      bundle.context,
      dir(),
      Bun.version,
      join(dir(), 'summary.json'),
      async (_context, endpoint) =>
        endpoint.includes('/jobs?') ? {total_count: jobs.length, jobs} : {total_count: artifacts.length, artifacts},
    )
    expect(result.conclusion).toBe('failure')
    expect(result.lanes[0].status).toBe('blocked')
    expect(result.lanes[1].status).toBe('fail')
    expect(result.lanes.filter((lane) => lane.status === 'pass')).toHaveLength(8)
    expect(result.provider_errors).toEqual([])
  },
)
it.each([99, 100, 199])('AC-25,27 complete attempt10 remains valid after %s historical uploads', async (count) => {
  const {bundle, jobs, artifacts} = await fixture('attempt10')
  const all = [
    ...Array.from({length: count}, (_, index) => ({
      id: 1000 + index,
      name: `validation-123-9-old-${index}`,
      expired: false,
      created_at: '2026-11-04T09:00:00Z',
    })),
    ...artifacts,
  ]
  let pages = 0
  const result = await runGate(
    bundle.context,
    dir(),
    Bun.version,
    join(dir(), 'summary.json'),
    async (_context, endpoint) => {
      if (endpoint.includes('/jobs?')) return {total_count: jobs.length, jobs}
      const page = Number(new URL('https://fixture.invalid' + endpoint).searchParams.get('page') ?? 1)
      pages++
      return {total_count: all.length, artifacts: all.slice((page - 1) * 100, page * 100)}
    },
  )
  expect(pages).toBe(Math.ceil(all.length / 100))
  expect(result.provider_errors).toEqual([])
  expect(result.conclusion).toBe('success')
  expect(result.lanes.every((lane) => lane.status === 'pass')).toBe(true)
})
it.each([
  'short-page',
  'changed-total',
  'repeat-page',
  'later-unavailable',
  'excess-count',
  'wrong-attempt',
  'duplicate-current',
])('AC-25,27 pagination remains fail-closed and retains siblings for %s', async (kind) => {
  const {bundle, jobs, artifacts} = await fixture('attempt10')
  const all = [
    ...Array.from({length: 100}, (_, index) => ({
      id: 1000 + index,
      name: `validation-123-9-old-${index}`,
      expired: false,
      created_at: '2026-11-04T09:00:00Z',
    })),
    ...artifacts.map((artifact) =>
      kind === 'wrong-attempt' ? {...artifact, name: artifact.name.replace('-10-', '-9-')} : artifact,
    ),
    ...(kind === 'duplicate-current' ? [{...artifacts[0], id: 9000}] : []),
  ]
  if (kind === 'later-unavailable') jobs[0].conclusion = 'failure'
  let pages = 0
  const result = await runGate(
    bundle.context,
    dir(),
    Bun.version,
    join(dir(), 'summary.json'),
    async (_context, endpoint) => {
      if (endpoint.includes('/jobs?')) return {total_count: jobs.length, jobs}
      const page = Number(new URL('https://fixture.invalid' + endpoint).searchParams.get('page') ?? 1)
      pages++
      if (kind === 'later-unavailable' && page > 1) throw new Error('later page unavailable')
      return {
        total_count: kind === 'excess-count' ? 10001 : all.length + (kind === 'changed-total' && page > 1 ? 1 : 0),
        artifacts:
          kind === 'short-page'
            ? all.slice(0, 99)
            : kind === 'repeat-page'
              ? all.slice(0, 100)
              : all.slice((page - 1) * 100, page * 100),
      }
    },
  )
  expect(pages).toBeLessThanOrEqual(2)
  expect(result.conclusion).toBe('failure')
  expect(result.lanes).toHaveLength(10)
  if (kind === 'duplicate-current') {
    expect(result.provider_errors).toEqual([])
    expect(result.lanes.filter((lane) => lane.status === 'pass')).toHaveLength(9)
  } else if (kind === 'wrong-attempt') {
    expect(result.provider_errors).toEqual([])
    expect(result.lanes.every((lane) => lane.status === 'blocked')).toBe(true)
  } else expect(result.provider_errors).toContain('Provider artifacts unavailable or invalid')
  if (kind === 'later-unavailable') expect(result.lanes[0].status).toBe('fail')
})
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
  const {bundle, jobs, artifacts} = await fixture(kind)
  const result = await deterministicGate(bundle.context, dir(), Bun.version, jobs, artifacts)
  expect(result.lanes).toHaveLength(10)
  expect(result.conclusion).toBe(kind === 'complete' ? 'success' : 'failure')
  if (kind === 'two-failures') {
    expect(result.lanes.filter((row) => row.status === 'fail')).toHaveLength(2)
    expect(result.lanes.filter((row) => row.status === 'pass')).toHaveLength(8)
  }
})
it.each([
  'complete',
  'jobs-unavailable',
  'artifacts-unavailable',
  'both',
  'malformed-jobs',
  'malformed-artifacts',
  'known-failure',
])('AC-25,27 persists all-results summary despite provider failure: %s', async (kind) => {
  const {bundle, jobs, artifacts} = await fixture('complete')
  if (kind === 'known-failure') jobs[0].conclusion = 'failure'
  const output = join(dir(), 'gate-summary.json')
  const result = await runGate(bundle.context, dir(), Bun.version, output, async (_context, endpoint) => {
    if (endpoint.includes('/jobs?')) {
      if (['jobs-unavailable', 'both'].includes(kind)) throw new Error('Unavailable jobs')
      return kind === 'malformed-jobs' ? {jobs: [{}]} : {total_count: jobs.length, jobs}
    }
    if (['artifacts-unavailable', 'both', 'known-failure'].includes(kind)) throw new Error('Unavailable artifacts')
    return kind === 'malformed-artifacts' ? {artifacts: [{}]} : {total_count: artifacts.length, artifacts}
  })
  expect(await Bun.file(output).json()).toEqual(result)
  expect(result.lanes).toHaveLength(10)
  expect(result.conclusion).toBe(kind === 'complete' ? 'success' : 'failure')
  if (kind !== 'complete') {
    expect(result.provider_errors.length).toBeGreaterThan(0)
    expect(result.lanes.every((lane) => lane.status === 'blocked' || lane.status === 'fail')).toBe(true)
  }
  if (kind === 'known-failure') {
    expect(result.lanes[0].status).toBe('fail')
    expect(result.lanes[0].provider_job_id).toBe(jobs[0].id)
  }
  if (kind === 'jobs-unavailable') expect(result.lanes[0].artifact_id).toBe(artifacts[0].id)
})
it('AC-25,27 actual gate entrypoint persists blocked rows after context failure', async () => {
  const repository = await createBareRepo(dir(), {'skills/deploy.md': SKILL_DEPLOY})
  const root = join(dir(), 'checkout')
  expect((await runPipe(dir(), ['git', 'clone', repository, root])).exitCode).toBe(0)
  await mkdir(join(root, 'scripts'))
  for (const file of [
    'gate.ts',
    'gate-summary.ts',
    'validation-context.ts',
    'validation-identity.ts',
    'evidence-io.ts',
    'evidence-schema.ts',
    'github-evidence.ts',
    'validation-lanes.ts',
    'validation-policy.ts',
    'validation-evidence.ts',
  ])
    await copyFile(join(repositoryRoot, 'scripts', file), join(root, 'scripts', file))
  await symlink(join(repositoryRoot, 'src'), join(root, 'src'), 'junction')
  await symlink(join(repositoryRoot, 'node_modules'), join(root, 'node_modules'), 'junction')
  const event = join(root, 'event.json')
  await writeFile(event, JSON.stringify({repository: {full_name: 'wrong/repository'}}))
  const result = await runPipe(root, [process.execPath, 'scripts/gate.ts'], {
    env: {GITHUB_ACTIONS: 'true', GITHUB_EVENT_PATH: event, GITHUB_REPOSITORY: 'crucibledx/forge-cli'},
  })
  expect(result.exitCode).toBe(1)
  const summary = await Bun.file(join(root, 'results/gate-summary.json')).json()
  expect(summary.context).toBeNull()
  expect(summary.conclusion).toBe('failure')
  expect(summary.lanes).toHaveLength(10)
  expect(summary.lanes.every((lane: {status: string}) => lane.status === 'blocked')).toBe(true)
})
