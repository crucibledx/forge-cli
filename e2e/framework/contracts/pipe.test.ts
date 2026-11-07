import {join} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {describe, expect, it} from 'bun:test'

import {runPipe} from '../pipe'
import {TAIL_BYTES} from '../process'

const fixture = join(import.meta.dir, 'fixtures/process.ts')

describe('BR-09 pipe contracts (AC-16)', () => {
  const dir = useTmpDir('pipe')
  it('drains floods concurrently, caps both tails and keeps channels separate', async () => {
    const result = await runPipe(dir(), [process.execPath, fixture, 'flood'])
    expect(result.exitCode).toBe(0)
    expect(result.signal).toBeNull()
    expect(result.timedOut).toBe(false)
    expect(result.stdout).toEndWith('stdout-end\n')
    expect(result.stderr).toEndWith('stderr-end\n')
    expect(result.stdout).not.toContain('stderr-end')
    expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(TAIL_BYTES)
    expect(Buffer.byteLength(result.stderr)).toBeLessThanOrEqual(TAIL_BYTES)
    expect(result.output).toBe(result.stdout)
  })
  it('decodes split Unicode without replacement characters', async () => {
    const result = await runPipe(dir(), [process.execPath, fixture, 'unicode'])
    expect(result.stdout).toBe('A🌍é終B\n')
    expect(result.stderr).toBe(result.stdout)
  })
  it('lets redaction tests inspect bounded raw fixture output before artifact sanitization', async () => {
    let raw = ''
    const result = await runPipe(
      dir(),
      [process.execPath, '-e', 'console.log("https://user:raw-sentinel@fixture.invalid")'],
      {
        inspectRaw: (stdout) => {
          raw = stdout
        },
      },
    )
    expect(raw).toContain('raw-sentinel')
    expect(result.stdout).not.toContain('raw-sentinel')
  })
  it('AC-18 inspection failure retains original error, both drained streams and observed nonzero exit', async () => {
    let failure: Error | undefined
    try {
      await runPipe(
        dir(),
        [
          process.execPath,
          '-e',
          "console.log('STDOUT_REASON token=PIPE_PRIVATE');console.error('STDERR_REASON');process.exit(7)",
        ],
        {
          env: {FC_SEED: '123', FC_PATH: '0:1'},
          inspectRaw: () => {
            throw new Error('original assertion token=PIPE_PRIVATE')
          },
        },
      )
    } catch (error) {
      failure = error as Error
    }
    expect(failure).toBeInstanceOf(Error)
    for (const text of [failure!.message, failure!.stack!]) {
      expect(text).toContain('original assertion')
      expect(text).toContain('STDOUT_REASON')
      expect(text).toContain('STDERR_REASON')
      expect(text).not.toContain('PIPE_PRIVATE')
      expect(text).not.toContain(dir())
      expect(Buffer.byteLength(text)).toBeLessThanOrEqual(TAIL_BYTES)
    }
    const context = JSON.parse(failure!.message.split('\nSession: ')[1].split('\nTranscript tail:')[0])
    expect(context).toMatchObject({
      exit: 7,
      signal: null,
      timedOut: false,
      timeoutMs: 10000,
      seed: '123',
      replay: '0:1',
    })
  })
  it('preserves literal argv and closes target stdin, including the Windows job bootstrap', async () => {
    const values = ['', 'a b', 'literal"quote', 'C:\\space here\\', '$HOME', '`literal`', '🌍']
    const result = await runPipe(dir(), [process.execPath, fixture, 'argv', ...values])
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual(values)
    expect((await runPipe(dir(), [process.execPath, fixture, 'eof'])).stdout).toBe('eof:\n')
  })
  it('preserves nonzero exits and signals', async () => {
    expect((await runPipe(dir(), [process.execPath, fixture, 'early'])).exitCode).toBe(7)
    const signalled = await runPipe(dir(), [process.execPath, fixture, 'signal'])
    if (process.platform === 'win32') {
      // Windows/Bun reports self-termination as an exit, not a POSIX signal.
      expect(signalled.exitCode).toBe(1)
      expect(signalled.signal).toBeNull()
    } else {
      expect(signalled.exitCode).toBeNull()
      expect(signalled.signal).toBe('SIGTERM')
    }
  })
  it('keeps raw stream controls visible while output remains the stripped-stdout alias', async () => {
    const result = await runPipe(dir(), [process.execPath, fixture, 'ansi'])
    expect(result.stdout).toBe('\x1b[?25lraw stdout\x1b[?25h')
    expect(result.stderr).toBe('\x1b[?2004hraw stderr\x1b[?2004l')
    expect(result.output).toBe('raw stdout')
  })
  it('caps split multibyte diagnostic tails without replacement damage', async () => {
    const result = await runPipe(dir(), [process.execPath, fixture, 'unicode-flood'])
    for (const stream of [result.stdout, result.stderr]) {
      expect(stream).not.toContain('\uFFFD')
      expect(stream).toEndWith('end\n')
      expect(Buffer.byteLength(stream)).toBeLessThanOrEqual(TAIL_BYTES)
    }
  })
  it('owns a descendant even when the original leader has already exited (AC-18,26)', async () => {
    const result = await runPipe(dir(), [process.execPath, fixture, 'leader-exits'])
    const {child} = JSON.parse(result.stdout)
    let alive = false
    try {
      process.kill(child, 0)
      if (process.platform === 'win32') alive = true
      else {
        const status = Bun.spawnSync(['ps', '-o', 'stat=', '-p', String(child)], {stdout: 'pipe', stderr: 'pipe'})
        alive = !new TextDecoder().decode(status.stdout).trim().startsWith('Z')
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
    } finally {
      if (alive)
        try {
          process.kill(child, 'SIGKILL')
        } catch {
          /* Test cleanup is not evidence that ownership worked. */
        }
    }
    expect(alive).toBe(false)
  })
})
