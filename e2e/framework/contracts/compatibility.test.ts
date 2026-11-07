import {useTmpDir} from '@test-helpers/tmp'
import {expect, it} from 'bun:test'

import {CLI_ENTRY} from '../constants'
import {sessionFailure} from '../failure'
import {runPipe} from '../pipe'
import {diagnosticJSON, TAIL_BYTES} from '../process'
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
it('AC-15,27 escaped diagnostic budgets follow actual JSON bytes without breaking Unicode', () => {
  for (const unit of ['a', '"', '\\', '\b', '\t', '\n', '\r', '\f', '\0', '\x01', 'é', 'λ', '😀', '\ud800', '\udc00'])
    for (const budget of [2, 16, 32, 127, 1024])
      for (const tail of [false, true]) {
        const input = unit.repeat(80),
          output = diagnosticJSON(input, budget, tail)
        expect(Buffer.byteLength(JSON.stringify(output))).toBeLessThanOrEqual(budget)
        expect(JSON.parse(JSON.stringify(output))).toBe(output)
        if (Buffer.byteLength(JSON.stringify(input)) <= budget) expect(output).toBe(input)
        if (unit === '😀')
          expect(output).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/u)
      }
})
it('AC-15,27 failure metadata stays parseable in message AND stack, including escaped and private fields', () => {
  for (const value of ['https://user:STACK_PRIVATE', '\x01'.repeat(4000)])
    for (const text of (() => {
      const error = sessionFailure(
        [new Error('primary-cause\n' + 'Y'.repeat(TAIL_BYTES))],
        {
          command: [process.execPath, 'fixture.ts', ...Array(14).fill(value)],
          cwd: dir(),
          exit: null,
          signal: 'SIGTERM',
          timedOut: true,
          timeoutMs: 10000,
          seed: value,
          replay: value,
        },
        '\0'.repeat(TAIL_BYTES) + '\nvisible-final-marker',
      )
      return [error.message, error.stack!]
    })()) {
      expect(Buffer.byteLength(text)).toBeLessThanOrEqual(TAIL_BYTES)
      expect(text).not.toContain('STACK_PRIVATE')
      expect(text).toContain('primary-cause')
      expect(text).toContain('visible-final-marker')
      const context = JSON.parse(text.split('\nSession: ')[1].split('\nTranscript tail:')[0])
      expect(context).toMatchObject({cwd: '.', exit: null, signal: 'SIGTERM', timedOut: true, timeoutMs: 10000})
      expect(context.command).toHaveLength(16)
      expect(context.seed).not.toBeNull()
      expect(context.replay).not.toBeNull()
    }
})
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
