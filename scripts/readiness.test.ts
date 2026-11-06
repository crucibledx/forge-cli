import {existsSync} from 'node:fs'
import {mkdir, readFile, unlink, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {expect, it} from 'bun:test'

import {runPipe} from '../e2e/framework/pipe'
import {writeEvidence} from './evidence-io'
import {fixtureProvider, readinessFixture} from './fixtures/readiness'
import {collectReadiness, readiness, readinessCLI, readinessInputPath} from './readiness'

const dir = useTmpDir('readiness')
async function fixture() {
  await mkdir(join(dir(), 'fixtures'))
  await writeFile(join(dir(), 'fixtures/check.log'), 'authenticated fixture evidence\n')
  await writeFile(join(dir(), '.bun-version'), Bun.version)
  const bundle = readinessFixture()
  for (const lane of bundle.lanes)
    for (const check of lane.checks)
      for (const ref of check.evidence) {
        await mkdir(join(dir(), 'checks', lane.lane_id), {recursive: true})
        await writeFile(join(dir(), ref), 'authenticated fixture evidence\n')
      }
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
  expect(
    JSON.parse(await readFile(output, 'utf8')).ac_results.every((row: {result: string}) => row.result === 'pass'),
  ).toBe(true)
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
  const report = await readiness(bundle, Bun.version, provider)
  expect(report.exit_code).toBe(1)
  expect(report.lane_results.filter((lane) => lane.status === 'fail')).toHaveLength(2)
  expect(report.lane_results.filter((lane) => lane.status === 'pass')).toHaveLength(8)
  expect(report.reasons.some((reason) => reason.subject === 'security' && reason.kind === 'blocked')).toBe(true)
})
it('AC-32 repeated input flags select one shared evidence root and bundle', async () => {
  const {bundle, provider} = await fixture()
  const old = join(dir(), 'old/bundle.json'),
    current = join(dir(), 'current/bundle.json'),
    output = join(dir(), 'report.json')
  await writeEvidence(old, {invalid: 'old bundle must not be selected'})
  await writeEvidence(current, bundle)
  const args = ['--', '--input', old, '--input', current, '--output', output]
  expect(readinessInputPath(args, dir())).toBe(current)
  expect(readinessInputPath(['--input', '--input', '--output', output], dir())).toBe(join(process.cwd(), '--input'))
  expect(await readinessCLI(args, provider, dir())).toBe(0)
  expect(JSON.parse(await Bun.file(output).text()).verdict).toBe('ready-for-owner-review')
})
it.each([
  'gate-auth',
  'gate-revision',
  'gate-context',
  'review-auth',
  'review-revision',
  'review-unavailable',
  'review-context',
  'trusted-gate',
  'trusted-review',
])('AC-32 only an authenticated gate/review establishes a known failure: %s', async (kind) => {
  const {bundle, provider} = await fixture()
  if (kind.includes('gate')) bundle.gate.conclusion = 'failure'
  else
    bundle.reviews[0].findings.push({
      id: 'known',
      severity: 'blocking',
      status: 'open',
      evidence: ['fixtures/check.log'],
    })
  const trusted = fixtureProvider(dir(), bundle)
  provider.gate = trusted.gate
  provider.producer = trusted.producer
  if (kind === 'gate-auth')
    provider.gate = async () => {
      throw new Error('Gate authentication unavailable')
    }
  if (kind === 'review-auth')
    provider.producer = async () => {
      throw new Error('Producer authentication unavailable')
    }
  if (kind.endsWith('context'))
    provider.context = async () => {
      throw new Error('Context unavailable')
    }
  if (kind === 'gate-revision') bundle.gate.tested_sha = 'f'.repeat(40)
  if (kind === 'review-revision') bundle.reviews[0].tested_sha = 'f'.repeat(40)
  if (kind === 'review-unavailable') {
    bundle.reviews[0].completion = 'unavailable'
    provider.producer = fixtureProvider(dir(), bundle).producer
  }
  const report = await readiness(bundle, Bun.version, provider)
  expect(report.exit_code).toBe(kind.startsWith('trusted') ? 1 : 2)
  expect(report.reasons.some((reason) => reason.kind === 'failure')).toBe(kind.startsWith('trusted'))
})
it.each([
  'stale-tested',
  'mixed-attempt',
  'missing-lane',
  'missing-role',
  'missing-verifier',
  'spoofed-producer',
  'same-review-verifier',
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
  if (kind === 'same-review-verifier') {
    bundle.verifier!.provenance.producer_id = bundle.reviews[0].provenance.producer_id
    bundle.verifier!.provenance.actor = bundle.reviews[0].provenance.actor
  }
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
  expect((await readiness(bundle, Bun.version, provider)).exit_code).not.toBe(0)
})
it('AC-32 malformed/missing AC records and output failures exit 2, remove stale reports, and never overwrite input', async () => {
  const {bundle, provider} = await fixture()
  const input = join(dir(), 'bundle.json'),
    output = join(dir(), 'report.json')
  bundle.verifier!.rows.pop()
  await writeEvidence(input, bundle)
  await writeEvidence(output, {schema_version: 1, verdict: 'ready-for-owner-review', ac_results: [], lane_results: []})
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
it.each(['session-substitution', 'cross-lane', 'wrong-check'])(
  'AC-25,32 blocks %s even when a permissive artifact resolver would accept it',
  async (kind) => {
    const {bundle, provider} = await fixture()
    const substitute =
      kind === 'session-substitution'
        ? bundle.reviews[0].provenance.source_uri
        : kind === 'cross-lane'
          ? 'checks/business/test-unit.log'
          : 'checks/quality/lint.log'
    for (const lane of bundle.lanes) for (const check of lane.checks) check.evidence = [substitute]
    provider.artifact = async () => {}
    const report = await readiness(bundle, Bun.version, provider)
    expect(report.exit_code).toBe(2)
    expect(report.reasons.some((reason) => reason.message.includes('own selected-run artifact'))).toBe(true)
  },
)
it('AC-32 missing deviations is not affirmative evidence of no deviations', async () => {
  await expect(collectReadiness(readinessFixture().context, dir())).rejects.toThrow()
  await writeEvidence(join(dir(), 'deviations.json'), [])
  expect((await collectReadiness(readinessFixture().context, dir())).deviations).toEqual([])
})
it.each(['producer', 'head', 'tested', 'unavailable', 'same-producer', 'context', 'row-evidence', 'row-exit'])(
  'AC-32 never publishes unauthenticated acceptance passes: %s',
  async (kind) => {
    const {bundle, provider} = await fixture()
    const verifier = bundle.verifier!
    if (kind === 'producer') {
      const original = provider.producer
      provider.producer = async (record, context) => {
        if ('phase' in record) throw new Error('Verifier authentication failed')
        await original(record, context)
      }
    }
    if (kind === 'head') verifier.head_sha = 'f'.repeat(40)
    if (kind === 'tested') verifier.tested_sha = 'f'.repeat(40)
    if (kind === 'unavailable') verifier.completion = 'unavailable'
    if (kind === 'same-producer') {
      verifier.provenance.producer_id = bundle.reviews[0].provenance.producer_id
      verifier.provenance.actor = bundle.reviews[0].provenance.actor
    }
    if (kind === 'context')
      provider.context = async () => {
        throw new Error('Checkout authentication failed')
      }
    if (kind === 'row-evidence') verifier.rows[0].evidence = ['fixtures/missing.log']
    if (kind === 'row-exit') verifier.rows[0].exit_code = 1
    if (['unavailable', 'same-producer', 'row-evidence', 'row-exit'].includes(kind))
      provider.producer = fixtureProvider(dir(), bundle).producer
    const report = await readiness(bundle, Bun.version, provider)
    expect(report.exit_code).toBe(2)
    expect(report.ac_results[0].result).toBe('blocked')
    expect(report.ac_results.filter((row) => row.result === 'pass')).toHaveLength(kind.startsWith('row-') ? 31 : 0)
  },
)
it.each(['authenticated', 'unverified'])(
  'AC-32 only a trusted verifier establishes a known failure: %s',
  async (kind) => {
    const {bundle, provider} = await fixture()
    bundle.verifier!.rows[0].result = 'fail'
    bundle.verifier!.rows[0].exit_code = 1
    const original = fixtureProvider(dir(), bundle).producer
    provider.producer = async (record, context) => {
      if (kind === 'unverified' && 'phase' in record) throw new Error('Verifier authentication failed')
      await original(record, context)
    }
    const report = await readiness(bundle, Bun.version, provider)
    expect(report.ac_results[0].result).toBe(kind === 'authenticated' ? 'fail' : 'blocked')
    expect(report.exit_code).toBe(kind === 'authenticated' ? 1 : 2)
  },
)
it.each(['stale-pass', 'stale-fail', 'expired-pass', 'unverified-fail', 'context'])(
  'AC-25,32 normalizes untrusted lane verdicts without suppressing siblings: %s',
  async (kind) => {
    const {bundle, provider} = await fixture()
    const lane = bundle.lanes[0]
    if (kind.endsWith('fail')) {
      lane.status = 'fail'
      lane.checks[0].exit_code = 1
    }
    if (kind.startsWith('stale')) lane.tested_sha = 'f'.repeat(40)
    if (kind === 'expired-pass' || kind === 'unverified-fail') {
      const original = provider.artifact
      provider.artifact = async (ref, context, citing) => {
        if (citing?.lane_id === lane.lane_id) throw new Error('Artifact expired or unauthenticated')
        await original(ref, context, citing)
      }
    }
    if (kind === 'context')
      provider.context = async () => {
        throw new Error('Context unavailable')
      }
    const report = await readiness(bundle, Bun.version, provider)
    expect(report.exit_code).toBe(2)
    expect(report.lane_results[0].status).toBe('blocked')
    expect(report.lane_results.filter((row) => row.status === 'pass')).toHaveLength(kind === 'context' ? 0 : 9)
  },
)
it.each(['authenticated', 'missing-failure-log', 'stale', 'context'])(
  'AC-25,32 preserves a proven check failure despite an unavailable sibling: %s',
  async (kind) => {
    const {bundle, provider} = await fixture()
    const lane = bundle.lanes.find((item) => item.lane_id === 'quality')!
    const failed = lane.checks.find((check) => check.id === 'format:check')!
    const unavailable = lane.checks.find((check) => check.id === 'lint')!
    lane.status = 'fail'
    failed.exit_code = 1
    bundle.gate.conclusion = 'cancelled'
    provider.gate = fixtureProvider(dir(), bundle).gate
    await unlink(join(dir(), unavailable.evidence[0]))
    if (kind === 'missing-failure-log') await unlink(join(dir(), failed.evidence[0]))
    if (kind === 'stale') lane.tested_sha = 'f'.repeat(40)
    if (kind === 'context')
      provider.context = async () => {
        throw new Error('Checkout authentication unavailable')
      }
    const report = await readiness(bundle, Bun.version, provider)
    expect(report.exit_code).toBe(kind === 'authenticated' ? 1 : 2)
    expect(report.lane_results.find((item) => item.lane_id === lane.lane_id)!.status).toBe('blocked')
    expect(
      report.reasons.some((reason) => reason.subject === `${lane.lane_id}/${failed.id}` && reason.kind === 'failure'),
    ).toBe(kind === 'authenticated')
    expect(
      report.reasons.some(
        (reason) => reason.subject === `${lane.lane_id}/${unavailable.id}` && reason.kind === 'blocked',
      ),
    ).toBe(true)
    expect(report.lane_results.filter((item) => item.status === 'pass')).toHaveLength(kind === 'context' ? 0 : 9)
  },
)
it.each(['verifier.json', 'reviews/code.json', 'checks/quality/lint.log', 'custom-source.json', 'context.json'])(
  'AC-32 protects source evidence from output writes AND stale cleanup: %s',
  async (file) => {
    const {bundle, provider} = await fixture()
    const input = join(dir(), 'bundle.json'),
      output = join(dir(), file)
    await mkdir(join(output, '..'), {recursive: true})
    const original = JSON.stringify(bundle.verifier)
    await writeFile(output, original)
    await writeEvidence(input, bundle)
    expect(await readinessCLI(['--input', input, '--output', output], provider, dir())).toBe(2)
    expect(await Bun.file(output).text()).toBe(original)
    await writeFile(input, 'invalid input')
    expect(await readinessCLI(['--input', input, '--output', output], provider, dir())).toBe(2)
    expect(await Bun.file(output).text()).toBe(original)
  },
)
