import {readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {expect, it} from 'bun:test'

import {remainingCIBudget, runLanes} from './check-lanes'
import {laneSchema} from './evidence-schema'
import {validationContext} from './validation-context'
import {CI_EVIDENCE_RESERVE_MS, LANE_BUDGET_MS, PLATFORMS, validationLanes} from './validation-lanes'
import {aggregateExit, assessLane} from './validation-policy'
import {executeCheck} from './validation-process'

const dir = useTmpDir('lane-fixtures')
it('AC-25,27 CI checks share elapsed setup/check time and leave cleanup/evidence headroom', () => {
  const lane = validationLanes[0],
    start = 1800000000000
  const marker = String(start / 1000)
  expect(remainingCIBudget(lane, marker, start)).toBe(LANE_BUDGET_MS - CI_EVIDENCE_RESERVE_MS)
  expect(remainingCIBudget(lane, marker, start + 120000)).toBe(LANE_BUDGET_MS - CI_EVIDENCE_RESERVE_MS - 120000)
  expect(remainingCIBudget(lane, marker, start + LANE_BUDGET_MS - CI_EVIDENCE_RESERVE_MS - 1500)).toBe(1500)
  expect(remainingCIBudget(lane, marker, start + LANE_BUDGET_MS)).toBe(0)
  for (const invalid of [
    undefined,
    '',
    'garbage',
    '-1',
    'Infinity',
    '999999999999999999999999',
    String(start / 1000 + 1),
  ])
    expect(remainingCIBudget(lane, invalid, start)).toBe(0)
})
it('AC-25 thrown setup outcomes retain all sibling logs and proven failure precedence', async () => {
  const context = validationContext()
  const reports = await runLanes(
    dir(),
    context,
    async (command) => {
      if (command.at(-1) === 'format:check') throw new Error('fixture scheduler setup failure')
      return {
        exit_code: command.at(-1) === 'typecheck' ? 2 : 0,
        duration_ms: 1,
        timed_out: false,
        stdout: 'sibling diagnostic',
        stderr: '',
      }
    },
    'linux',
  )
  expect(reports).toHaveLength(validationLanes.length)
  expect(aggregateExit(reports)).toBe(1)
  const quality = reports.find((lane) => lane.lane_id === 'quality')!
  const setup = quality.checks.find((check) => check.id === 'format:check')!
  expect(setup.exit_code).toBeNull()
  expect(setup.reason).toContain('fixture scheduler setup failure')
  expect(reports.find((lane) => lane.lane_id === 'agent-cli')?.status).toBe('pass')
  expect(JSON.parse(await readFile(join(dir(), setup.evidence[0]), 'utf8')).reason).toContain('setup failure')
})
it('AC-25 actual pinned compiler diagnostics retain exit2 and fail the aggregate', async () => {
  await writeFile(
    join(dir(), 'tsconfig.json'),
    JSON.stringify({compilerOptions: {types: [], noEmit: true}, files: ['bad.ts']}),
  )
  await writeFile(join(dir(), 'bad.ts'), 'const value: number = "not a number"\n')
  const context = validationContext()
  const out = join(dir(), 'evidence')
  const reports = await runLanes(
    out,
    context,
    async (command) =>
      command.at(-1) === 'typecheck'
        ? executeCheck(
            [
              process.execPath,
              join(import.meta.dir, '../node_modules/typescript/bin/tsc'),
              '--project',
              join(dir(), 'tsconfig.json'),
            ],
            dir(),
            10000,
          )
        : {exit_code: 0, duration_ms: 1, timed_out: false, stdout: '', stderr: ''},
    'linux',
  )
  const quality = reports.find((lane) => lane.lane_id === 'quality')!
  const check = quality.checks.find((item) => item.id === 'typecheck')!
  expect(check.exit_code).toBe(2)
  expect(check.reason).toBeUndefined()
  expect(quality.status).toBe('fail')
  expect(aggregateExit(reports)).toBe(1)
  const original = JSON.parse(await readFile(join(out, check.evidence[0]), 'utf8'))
  expect(original.stdout).toContain('TS2322')
  expect(assessLane(quality, context, Bun.version)).toEqual(quality)
})
it.each(['typecheck', 'check:security-audit', 'test:e2e'])(
  'AC-25 exit2 follows the registered command contract: %s',
  async (selected) => {
    const context = validationContext()
    const reports = await runLanes(
      dir(),
      context,
      async (command) => ({
        exit_code: command.at(-1) === selected ? 2 : 0,
        duration_ms: 1,
        timed_out: false,
        stdout: '',
        stderr: command.at(-1) === selected ? 'fixture command diagnostic' : '',
      }),
      'linux',
    )
    const report = reports.find((lane) => lane.checks.some((check) => check.id === selected))!
    const check = report.checks.find((check) => check.id === selected)!
    expect(report.status).toBe(selected === 'typecheck' ? 'fail' : 'blocked')
    expect(aggregateExit(reports)).toBe(selected === 'typecheck' ? 1 : 2)
    expect(check.reason).toBe(
      selected === 'typecheck' ? undefined : 'Command reports incomplete/unavailable validation',
    )
    expect(assessLane(report, context, Bun.version)).toEqual(report)
  },
)
it('AC-25 preserves two simultaneous failures, later successes and foreign-native blockers, maximum two active commands', async () => {
  let active = 0,
    maximum = 0
  const called: string[] = []
  const context = validationContext()
  const reports = await runLanes(
    dir(),
    context,
    async (command) => {
      called.push(command.join(' '))
      maximum = Math.max(maximum, ++active)
      await Promise.resolve()
      active--
      return {
        exit_code: ['format:check', 'test:unit'].includes(command.at(-1)!) ? 1 : 0,
        duration_ms: 1,
        timed_out: false,
        stdout: 'fixture outcome',
        stderr: '',
      }
    },
    'linux',
  )
  expect(maximum).toBeLessThanOrEqual(2)
  expect(reports).toHaveLength(validationLanes.length)
  expect(reports.filter((report) => report.status === 'fail').map((report) => report.lane_id)).toEqual([
    'quality',
    'business',
  ])
  expect(reports.find((report) => report.lane_id === 'agent-cli')?.status).toBe('pass')
  expect(reports.find((report) => report.lane_id === 'native-windows')?.status).toBe('blocked')
  expect(called).toContain('bun run test:compiled')
  expect(called).toContain('bun run typecheck')
  expect(aggregateExit(reports)).toBe(1)
  for (const report of reports) expect(assessLane(report, context, Bun.version)).toEqual(report)
  const good = reports.find((report) => report.status === 'pass')!
  for (const runner_os of Object.values(PLATFORMS))
    expect(laneSchema.safeParse({...good, runner_os}).success).toBe(true)
  expect(laneSchema.safeParse({...good, runner_os: 'freebsd'}).success).toBe(false)
  expect(() => assessLane({...good, tested_sha: 'f'.repeat(40)}, context, Bun.version)).toThrow('stale/mixed')
  expect(() => assessLane({...good, run_attempt: 99}, context, Bun.version)).toThrow('stale/mixed')
  expect(() => assessLane({...good, checks: []}, context, Bun.version)).toThrow()
  expect(() =>
    assessLane({...good, checks: good.checks.map((check) => ({...check, exit_code: 1}))}, context, Bun.version),
  ).toThrow('contradicts')
})
