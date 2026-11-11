import {copyFile, mkdir, symlink, writeFile} from 'node:fs/promises'
import {basename, join, resolve} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {expect, it} from 'bun:test'

import {SKILL_DEPLOY} from '../e2e/fixtures/sources'
import {createBareRepo} from '../e2e/framework/git'
import {runPipe} from '../e2e/framework/pipe'
import {readEvidence, writeEvidence} from './evidence-io'
import type {EvidenceContext} from './evidence-schema'
import {laneFixture} from './fixtures/lanes'
import {artifactName, deterministicGate as actualDeterministicGate, runGate as actualRunGate} from './gate'
import {githubJSON} from './github-evidence'
import {repositoryRoot} from './validation-context'
import {validationLanes} from './validation-lanes'

const dir = useTmpDir('gate')
// Only I/O is replaced. Both production entrypoints derive and expose their canonical paths.
function fixtureReader(incoming: string): typeof readEvidence {
  return async (folder, ref) => {
    expect(folder).toBe(resolve(repositoryRoot, 'results/incoming', basename(folder)))
    return readEvidence(join(incoming, basename(folder)), ref)
  }
}
function deterministicGate(
  context: EvidenceContext,
  incoming: string,
  pin: string,
  jobs: Parameters<typeof actualDeterministicGate>[2],
  artifacts: Parameters<typeof actualDeterministicGate>[3],
) {
  return actualDeterministicGate(context, pin, jobs, artifacts, fixtureReader(incoming))
}
function runGate(context: EvidenceContext, incoming: string, pin: string, output: string, read = githubJSON) {
  return actualRunGate(context, pin, {
    githubJSON: read,
    readEvidence: fixtureReader(incoming),
    writeEvidence: async (path, data) => {
      expect(path).toBe(resolve(repositoryRoot, 'results/gate-summary.json'))
      await writeEvidence(output, data)
    },
  })
}
async function fixture(kind: string) {
  const bundle = laneFixture(),
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
it.each([
  'artifact',
  'start',
  'end',
  'reversed',
  ...['missing', 'typed', 'null'].flatMap((kind) => ['artifact', 'start', 'end'].map((field) => `${kind}-${field}`)),
])('AC-25,27,32 malformed timestamp %s blocks only its row and preserves known sibling failure', async (kind) => {
  const {bundle, jobs, artifacts} = await fixture('complete')
  if (kind === 'artifact') artifacts[0].created_at = 'not-an-ISO-date'
  if (kind === 'start') jobs[0].started_at = 'not-an-ISO-date'
  if (kind === 'end') jobs[0].completed_at = 'not-an-ISO-date'
  if (kind === 'reversed') jobs[0].started_at = '2026-11-04T10:02:00Z'
  const [defect, field] = kind.split('-')
  if (['missing', 'typed', 'null'].includes(defect)) {
    const target = field === 'artifact' ? artifacts[0] : jobs[0]
    const key = field === 'artifact' ? 'created_at' : field === 'start' ? 'started_at' : 'completed_at'
    if (defect === 'missing') Reflect.deleteProperty(target, key)
    else Reflect.set(target, key, defect === 'null' ? null : {invalid: 'timestamp'})
  }
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
})
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
])('AC-25,27,32 selected provider run rejects %s while reporting every sibling', async (kind) => {
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
it.each([
  ['stale-success', 'pass', ''],
  ['stale-success-no-end', 'blocked', 'Required provider job unfinished (status in_progress)'],
  ['stale-success-invalid-end', 'blocked', 'Required provider job unfinished (status in_progress)'],
  ['unfinished', 'blocked', 'Required provider job unfinished (status in_progress)'],
  ['queued', 'blocked', 'Required provider job unfinished (status queued)'],
  ['stale-failure', 'fail', 'Required provider job concluded failure'],
  ['unfinished-failure', 'fail', 'Required provider job concluded failure'],
  ['completed-failure', 'fail', 'Required provider job concluded failure'],
  ['cancelled', 'blocked', 'Required provider job concluded cancelled'],
  ['missing', 'blocked', 'Required provider job missing'],
  ['duplicate', 'blocked', 'Required provider job duplicated'],
])('provider job state %s gives lane %s and names the defect', async (kind, status, reason) => {
  const {bundle, jobs, artifacts} = await fixture('complete')
  const state: Record<string, object> = {
    'stale-success': {status: 'in_progress'},
    'stale-success-no-end': {status: 'in_progress', completed_at: null},
    'stale-success-invalid-end': {status: 'in_progress', completed_at: 'not-an-ISO-date'},
    unfinished: {status: 'in_progress', conclusion: null, completed_at: null},
    queued: {status: 'queued', conclusion: null, started_at: null, completed_at: null},
    'stale-failure': {status: 'in_progress', conclusion: 'failure'},
    'unfinished-failure': {status: 'in_progress', conclusion: 'failure', completed_at: null},
    'completed-failure': {conclusion: 'failure'},
    cancelled: {conclusion: 'cancelled'},
  }
  Object.assign(jobs[0], state[kind])
  const provided = kind === 'missing' ? jobs.slice(1) : kind === 'duplicate' ? [...jobs, {...jobs[0], id: 99}] : jobs
  const result = await runGate(
    bundle.context,
    dir(),
    Bun.version,
    join(dir(), 'summary.json'),
    async (_context, endpoint) =>
      endpoint.includes('/jobs?')
        ? {total_count: provided.length, jobs: provided}
        : {total_count: artifacts.length, artifacts},
  )
  expect(result.provider_errors).toEqual([])
  expect(result.lanes[0]).toMatchObject({status, reason})
  expect(result.lanes[0].reason).not.toContain('success')
  expect(result.lanes.slice(1).every((lane) => lane.status === 'pass')).toBe(true)
  expect(result.conclusion).toBe(status === 'pass' ? 'success' : 'failure')
})
it('AC-25,27 actual gate entrypoint persists blocked rows after context failure', async () => {
  const repository = await createBareRepo(dir(), {'skills/deploy.md': SKILL_DEPLOY})
  const root = join(dir(), 'checkout')
  expect((await runPipe(dir(), ['git', 'clone', repository, root])).exitCode).toBe(0)
  await mkdir(join(root, 'scripts'))
  await copyFile(join(repositoryRoot, 'package.json'), join(root, 'package.json'))
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
