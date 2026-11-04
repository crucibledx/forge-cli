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
  it('preserves nonzero exits and signals', async () => {
    expect((await runPipe(dir(), [process.execPath, fixture, 'early'])).exitCode).toBe(7)
    const signalled = await runPipe(dir(), [process.execPath, fixture, 'signal'])
    expect(signalled.exitCode).toBeNull()
    expect(signalled.signal).toBe('SIGTERM')
  })
})
