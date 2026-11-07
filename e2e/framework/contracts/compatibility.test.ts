import {useTmpDir} from '@test-helpers/tmp'
import {expect, it} from 'bun:test'

import {CLI_ENTRY} from '../constants'
import {runPipe} from '../pipe'
import {TAIL_BYTES} from '../process'
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
const dir = useTmpDir('compatibility-failure')
it.each(['snapshot', 'large-output', 'large-arguments', 'real'])(
  'AC-15,18,27,30 pipe timeout keeps bounded private invocation metadata: %s',
  async (kind) => {
    const env = {FC_SEED: '123', FC_PATH: '0:1'}
    const args =
      kind === 'large-arguments'
        ? ['--fixture', 'token=PIPE_PRIVATE', ...Array.from({length: 40}, () => 'é'.repeat(4000))]
        : ['--fixture', 'token=PIPE_PRIVATE']
    let observed: CLIResult | undefined, error: Error | undefined
    try {
      await runCommand(dir(), 'status', args, env, async (cwd, argv, options) => {
        expect(argv.slice(0, 4)).toEqual([process.execPath, 'run', CLI_ENTRY, 'status'])
        if (kind === 'real') observed = await runPipe(cwd, argv, {...options, timeoutMs: 1})
        else
          observed = {
            ...timedOut,
            signal: 'SIGTERM',
            stdout: (kind === 'large-output' ? 'é'.repeat(TAIL_BYTES) : '') + '\nBearer PIPE_PRIVATE\nlast-pipe-marker',
          }
        env.FC_SEED = '456'
        env.FC_PATH = '0:2'
        return observed
      })
    } catch (value) {
      error = value as Error
    }
    expect(observed?.timedOut).toBe(true)
    expect(error).toBeInstanceOf(Error)
    const context = JSON.parse(error!.message.split('\nSession: ')[1].split('\nTranscript tail:')[0])
    expect(context).toMatchObject({
      cwd: '.',
      exit: observed!.exitCode,
      signal: observed!.signal,
      timedOut: true,
      timeoutMs: 10000,
      seed: '123',
      replay: '0:1',
    })
    expect(context.command.slice(0, 4)).toEqual(['<runtime>', 'run', '<repository>/src/main.ts', 'status'])
    if (kind !== 'real') expect(error!.message).toContain('last-pipe-marker')
    for (const output of [error!.message, error!.stack!]) {
      expect(output).toContain('Command deadline exceeded')
      expect(output).not.toContain('PIPE_PRIVATE')
      expect(output).not.toContain(dir())
      expect(output).not.toContain(process.execPath)
      expect(Buffer.byteLength(output)).toBeLessThanOrEqual(TAIL_BYTES)
    }
    expect(error!.cause).toBeUndefined()
  },
)
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
