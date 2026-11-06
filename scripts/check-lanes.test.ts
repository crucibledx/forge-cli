import {useTmpDir} from '@test-helpers/tmp'
import {expect, it} from 'bun:test'

import {runLanes} from './check-lanes'
import {validationContext} from './validation-context'
import {validationLanes} from './validation-lanes'
import {aggregateExit, assessLane} from './validation-policy'

const dir = useTmpDir('lane-fixtures')
it('AC-25 preserves two simultaneous failures, later successes and foreign-native blockers, maximum two active commands', async () => {
  let active = 0,
    maximum = 0
  const called: string[] = []
  const context = validationContext()
  const reports = await runLanes(
    dir(),
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
  expect(() => assessLane({...good, tested_sha: 'f'.repeat(40)}, context, Bun.version)).toThrow('stale/mixed')
  expect(() => assessLane({...good, run_attempt: 99}, context, Bun.version)).toThrow('stale/mixed')
  expect(() => assessLane({...good, checks: []}, context, Bun.version)).toThrow()
  expect(() =>
    assessLane({...good, checks: good.checks.map((check) => ({...check, exit_code: 1}))}, context, Bun.version),
  ).toThrow('contradicts')
})
