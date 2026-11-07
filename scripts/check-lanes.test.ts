import {readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {expect, it} from 'bun:test'

import {remainingCIBudget, runLanes} from './check-lanes'
import {readEvidence} from './evidence-io'
import {laneSchema} from './evidence-schema'
import {validationContext} from './validation-context'
import {CI_EVIDENCE_RESERVE_MS, LANE_BUDGET_MS, PLATFORMS, validationLanes} from './validation-lanes'
import {aggregateExit, assessLane} from './validation-policy'
import {commandMetadata, executeCheck} from './validation-process'

const dir = useTmpDir('lane-fixtures')
it.each(['raw', 'already-private'])(
  'AC-15,25,27 retained %s URL diagnostics remain structured and keep all fields',
  async (kind) => {
    const reports = await runLanes(
      dir(),
      validationContext(),
      async (command) => ({
        ...commandMetadata(),
        exit_code: command.at(-1) === 'format:check' ? 1 : 0,
        duration_ms: 1,
        timed_out: false,
        signal: 'SIGTERM',
        seed: '123',
        replay: '0:1',
        stdout: kind === 'raw' ? 'https://user:LOG_PRIVATE' : 'https://[redacted]',
        stderr: 'visible-error-marker',
      }),
      'linux',
    )
    expect(reports).toHaveLength(10)
    expect(aggregateExit(reports)).toBe(1)
    expect(reports.find((lane) => lane.lane_id === 'business')!.status).toBe('pass')
    const ref = reports.find((lane) => lane.lane_id === 'quality')!.checks[0].evidence[0]
    const raw = await readEvidence(dir(), ref)
    expect(raw).not.toContain('LOG_PRIVATE')
    expect(JSON.parse(raw)).toMatchObject({
      command: ['bun', 'run', 'format:check'],
      signal: 'SIGTERM',
      cwd: '.',
      seed: '123',
      replay: '0:1',
      exit_code: 1,
      duration_ms: 1,
      timed_out: false,
      stdout: 'https://[redacted]',
      stderr: 'visible-error-marker',
    })
  },
)
it('AC-25,27 actual escaped stdout/stderr log fits unchanged readers and retains a proven failed check', async () => {
  const result = await executeCheck(
    [
      process.execPath,
      '-e',
      "process.stdout.write('\\0'.repeat(262144)+'visible-stdout-end');process.stderr.write('\\0'.repeat(262144)+'visible-stderr-end');process.exitCode=1",
    ],
    5000,
  )
  expect(result.exit_code).toBe(1)
  const reports = await runLanes(
    dir(),
    validationContext(),
    async (command) =>
      command.at(-1) === 'format:check'
        ? result
        : {
            ...commandMetadata(),
            exit_code: 0,
            duration_ms: 1,
            timed_out: false,
            stdout: 'ordinary sibling',
            stderr: '',
          },
    'linux',
  )
  expect(reports).toHaveLength(10)
  expect(aggregateExit(reports)).toBe(1)
  expect(reports.find((lane) => lane.lane_id === 'quality')!.status).toBe('fail')
  expect(reports.find((lane) => lane.lane_id === 'business')!.status).toBe('pass')
  const ref = reports.find((lane) => lane.lane_id === 'quality')!.checks[0].evidence[0]
  const raw = await readEvidence(dir(), ref),
    log = JSON.parse(raw)
  expect(Buffer.byteLength(raw)).toBeLessThanOrEqual(2 * 1024 * 1024)
  expect(log.exit_code).toBe(1)
  expect(log.stdout).toContain('[truncated]')
  expect(log.stderr).toContain('[truncated]')
  expect(log.stdout).toEndWith('visible-stdout-end')
  expect(log.stderr).toEndWith('visible-stderr-end')
  expect(log).toMatchObject({cwd: '.', signal: null, seed: null, replay: null, timed_out: false})
})
it('AC-15,25,27,30 oversized thrown reason retains every sibling and independently known failure', async () => {
  const reports = await runLanes(
    dir(),
    validationContext(),
    async (command) => {
      if (command.at(-1) === 'format:check')
        throw new Error('primary validator unavailable https://user:X_LANE_PRIVATE\n' + 'é'.repeat(300000))
      return {
        ...commandMetadata(),
        exit_code: command.at(-1) === 'test:unit' ? 1 : 0,
        duration_ms: 1,
        timed_out: false,
        stdout: 'visible sibling',
        stderr: '',
      }
    },
    'linux',
  )
  expect(reports).toHaveLength(validationLanes.length)
  expect(aggregateExit(reports)).toBe(1)
  expect(reports.find((lane) => lane.lane_id === 'business')!.status).toBe('fail')
  expect(reports.find((lane) => lane.lane_id === 'agent-cli')!.status).toBe('pass')
  const check = reports.find((lane) => lane.lane_id === 'quality')!.checks[0]
  expect(check.reason).toContain('primary validator unavailable')
  expect(Buffer.byteLength(check.reason!)).toBeLessThanOrEqual(16000)
  const retained = await readFile(join(dir(), check.evidence[0]), 'utf8')
  expect(retained).not.toContain('X_LANE_PRIVATE')
  expect(JSON.stringify(reports)).not.toContain('X_LANE_PRIVATE')
  expect(Buffer.byteLength(retained)).toBeLessThan(262144)
})
it('AC-18,25,27 retained lane logs contain actual runner signal, relative cwd and selected replay', async () => {
  if (process.platform === 'win32') return
  const saved = {seed: process.env.FC_SEED, replay: process.env.FC_PATH}
  process.env.FC_SEED = '123'
  process.env.FC_PATH = '0:1'
  try {
    const reports = await runLanes(
      dir(),
      validationContext(),
      async (command) =>
        command.at(-1) === 'lint'
          ? executeCheck(
              [
                process.execPath,
                '-e',
                "process.stderr.write('runner terminated');process.kill(process.pid, 'SIGTERM')",
              ],
              5000,
            )
          : {...commandMetadata(), exit_code: 0, duration_ms: 1, timed_out: false, stdout: '', stderr: ''},
      'linux',
    )
    expect(aggregateExit(reports)).toBe(1)
    const quality = reports.find((lane) => lane.lane_id === 'quality')!
    const lint = quality.checks.find((check) => check.id === 'lint')!
    const retained = JSON.parse(await readFile(join(dir(), lint.evidence[0]), 'utf8'))
    expect(retained).toMatchObject({
      signal: 'SIGTERM',
      cwd: '.',
      seed: '123',
      replay: '0:1',
      timed_out: false,
      stderr: 'runner terminated',
    })
    expect(retained.command).toEqual(['bun', 'run', 'lint'])
    const foreign = reports.find((lane) => lane.lane_id === 'native-windows')!
    const blocked = JSON.parse(await readFile(join(dir(), foreign.checks[0].evidence[0]), 'utf8'))
    expect(blocked).toMatchObject({signal: null, cwd: '.', seed: '123', replay: '0:1', exit_code: null})
  } finally {
    if (saved.seed === undefined) delete process.env.FC_SEED
    else process.env.FC_SEED = saved.seed
    if (saved.replay === undefined) delete process.env.FC_PATH
    else process.env.FC_PATH = saved.replay
  }
})
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
        ...commandMetadata(),
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
            10000,
          )
        : {...commandMetadata(), exit_code: 0, duration_ms: 1, timed_out: false, stdout: '', stderr: ''},
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
        ...commandMetadata(),
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
        ...commandMetadata(),
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
