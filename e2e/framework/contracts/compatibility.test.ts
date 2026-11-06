import {expect, it, mock} from 'bun:test'

const timedOut = {
  stdout: 'bounded out',
  stderr: 'bounded err',
  output: 'bounded out',
  exitCode: 0,
  signal: null,
  timedOut: true,
}
mock.module('../pipe', () => ({runPipe: async () => timedOut}))
mock.module('../spawn', () => ({
  spawnInteractive: () => ({waitForExit: async () => timedOut, dispose: async () => {}}),
}))
const {runCommand, runInitSession} = await import('../run')
const {runPipe} = await import('../pipe')
it('AC-18 compatibility runners reject deadline expiry even when the raw exit is zero', async () => {
  expect((await runPipe('', [])).exitCode).toBe(0)
  expect((await runPipe('', [])).timedOut).toBe(true)
  await expect(runCommand('', 'status')).rejects.toThrow('deadline exceeded')
  await expect(runInitSession('', async () => {})).rejects.toThrow('deadline exceeded')
})
