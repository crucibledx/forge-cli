import {expect, it} from 'bun:test'

import {runCommand, runInitSession} from '../run'
import type {CLIResult, CLISession} from '../spawn'

const timedOut = {
  stdout: 'bounded out',
  stderr: 'bounded err',
  output: 'bounded out',
  exitCode: 0,
  signal: null,
  timedOut: true,
}
const execute = async () => timedOut
function session(result: CLIResult): CLISession {
  return {
    deadlineAt: performance.now() + 10000,
    getOutput: () => result.output,
    failure: (errors) => new Error(errors.map(String).join('\n') + '\n' + result.output),
    mark: () => 0,
    waitForText: () => {
      throw new Error('Unexpected fixture prompt wait')
    },
    waitForExit: async () => result,
    dispose: async () => {},
  }
}
it('AC-18 compatibility runners reject deadline expiry even when the raw exit is zero', async () => {
  expect((await execute()).exitCode).toBe(0)
  expect((await execute()).timedOut).toBe(true)
  await expect(runCommand('', 'status', [], {}, execute)).rejects.toThrow('deadline exceeded')
  await expect(
    runInitSession(
      '',
      async () => {},
      [],
      () => session(timedOut),
    ),
  ).rejects.toThrow('deadline exceeded')
})
it('AC-18 retains the PTY transcript when compatibility completion times out after the driver returns', async () => {
  const result = {...timedOut, stdout: '', stderr: '', output: 'PTY final expected message, then command hung'}
  await expect(
    runInitSession(
      '',
      async () => {},
      [],
      () => session(result),
    ),
  ).rejects.toThrow(result.output)
})
