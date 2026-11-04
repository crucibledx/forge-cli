import {existsSync} from 'node:fs'
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {expect, it} from 'bun:test'

import {runPipe} from '../e2e/framework/pipe'
import {writeEvidence} from './evidence-io'
import {fixtureProvider, readinessFixture} from './fixtures/readiness'
import {readiness, readinessCLI} from './readiness'

const dir = useTmpDir('readiness')
async function fixture() {
  await mkdir(join(dir(), 'fixtures'))
  await writeFile(join(dir(), 'fixtures/check.log'), 'authenticated fixture evidence\n')
  await writeFile(join(dir(), '.bun-version'), Bun.version)
  const bundle = readinessFixture()
  return {bundle, provider: fixtureProvider(dir(), bundle)}
}
it('AC-32 phase 1 needs no prior report; a complete synthetic bundle reaches owner review through the actual CLI parser', async () => {
  const {bundle} = await fixture()
  expect(existsSync(join(dir(), 'results/readiness.json'))).toBe(false)
  const input = join(dir(), 'bundle.json'),
    output = join(dir(), 'report.json'),
    entry = join(dir(), 'fixture-cli.ts')
  await writeEvidence(input, bundle)
  await writeFile(
    entry,
    `import {readinessCLI} from ${JSON.stringify(join(import.meta.dir, 'readiness.ts'))}\nimport {fixtureProvider} from ${JSON.stringify(join(import.meta.dir, 'fixtures/readiness.ts'))}\nconst input=JSON.parse(await Bun.file(${JSON.stringify(input)}).text());process.exitCode=await readinessCLI(Bun.argv.slice(2),fixtureProvider(${JSON.stringify(dir())},input),${JSON.stringify(dir())})\n`,
  )
  const result = await runPipe(dir(), [process.execPath, entry, '--input', input, '--output', output])
  expect(result.exitCode).toBe(0)
  expect(JSON.parse(await readFile(output, 'utf8')).verdict).toBe('ready-for-owner-review')
  const before = await readFile(input)
  expect((await runPipe(dir(), [process.execPath, entry, '--input', input, '--output', output])).exitCode).toBe(0)
  expect(await readFile(input)).toEqual(before)
})
it('AC-32 two failures dominate missing evidence while all sibling successes remain reported', async () => {
  const {bundle, provider} = await fixture()
  for (const lane of bundle.lanes.slice(0, 2)) {
    lane.status = 'fail'
    lane.checks[0].exit_code = 1
  }
  bundle.reviews = []
  const report = await readiness(bundle, dir(), Bun.version, provider)
  expect(report.exit_code).toBe(1)
  expect(report.lane_results.filter((lane) => lane.status === 'fail')).toHaveLength(2)
  expect(report.lane_results.filter((lane) => lane.status === 'pass')).toHaveLength(8)
  expect(report.reasons.some((reason) => reason.subject === 'security' && reason.kind === 'blocked')).toBe(true)
})
it.each([
  'stale-tested',
  'mixed-attempt',
  'missing-lane',
  'missing-role',
  'missing-verifier',
  'spoofed-producer',
  'self-resolved',
  'open-blocker',
  'gate-skipped',
  'foreign-native',
  'invalid-path',
  'pending-deviation',
  'rejected-deviation',
  'mismatched-approval',
])('AC-32 rejects %s without an AI override', async (kind) => {
  const {bundle, provider} = await fixture()
  if (kind === 'stale-tested') bundle.lanes[0].tested_sha = 'f'.repeat(40)
  if (kind === 'mixed-attempt') bundle.lanes[0].run_attempt = 2
  if (kind === 'missing-lane') bundle.lanes.pop()
  if (kind === 'missing-role') bundle.reviews.pop()
  if (kind === 'missing-verifier') bundle.verifier = null
  if (kind === 'spoofed-producer') bundle.reviews[0].provenance.actor = 'implementer'
  if (kind === 'self-resolved' || kind === 'open-blocker')
    bundle.reviews[0].findings.push({
      id: 'P1',
      severity: 'blocking',
      status: kind === 'open-blocker' ? 'open' : 'resolved',
      evidence: ['fixtures/check.log'],
    })
  if (kind === 'gate-skipped') bundle.gate.conclusion = 'skipped'
  if (kind === 'foreign-native') bundle.lanes.find((lane) => lane.lane_id === 'native-windows')!.runner_os = 'linux'
  if (kind === 'invalid-path') bundle.lanes[0].checks[0].evidence = ['missing/artifact.log']
  if (kind.includes('deviation') || kind === 'mismatched-approval')
    bundle.deviations.push({
      schema_version: 1,
      id: 'D1',
      description: 'synthetic only',
      ac_ids: ['AC-26'],
      contract_diff_sha256: 'd'.repeat(64),
      head_sha: bundle.context.head_sha,
      tested_sha: bundle.context.tested_sha,
      approval: {
        decision: kind === 'pending-deviation' ? 'pending' : kind === 'rejected-deviation' ? 'rejected' : 'approved',
        actor: 'NazarUsik',
        source_uri: 'https://github.com/crucibledx/forge-cli/issues/99#issuecomment-123',
        approved_at: '2026-11-04T12:00:00.000Z',
      },
    })
  expect((await readiness(bundle, dir(), Bun.version, provider)).exit_code).not.toBe(0)
})
it('AC-32 malformed/missing AC records and output failures exit 2, remove stale reports, and never overwrite input', async () => {
  const {bundle, provider} = await fixture()
  const input = join(dir(), 'bundle.json'),
    output = join(dir(), 'report.json')
  bundle.verifier!.rows.pop()
  await writeEvidence(input, bundle)
  await writeEvidence(output, {verdict: 'ready-for-owner-review'})
  expect(await readinessCLI(['--input', input, '--output', output], provider, dir())).toBe(2)
  expect(existsSync(output)).toBe(false)
  await writeEvidence(input, readinessFixture())
  await writeFile(join(dir(), 'blocked-parent'), 'not a directory')
  expect(
    await readinessCLI(
      ['--input', input, '--output', join(dir(), 'blocked-parent/report.json')],
      fixtureProvider(dir(), readinessFixture()),
      dir(),
    ),
  ).toBe(2)
  expect(await readinessCLI(['--input', input, '--output', input], provider, dir())).toBe(2)
  expect(existsSync(input)).toBe(true)
})
