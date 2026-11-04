import {join} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {describe, expect, it} from 'bun:test'

import {spawnPty} from '../spawn'

const fixture = join(import.meta.dir, 'fixtures/process.ts')

describe('BR-09 PTY contracts (AC-17)', () => {
  const dir = useTmpDir('pty')
  it('consumes repeated prompts, chaining actual input writes', async () => {
    const cli = spawnPty(dir(), [process.execPath, fixture, 'prompts'])
    try {
      await cli.waitForText('prompt> ')
      await expect(cli.waitForText('prompt> ', 25)).rejects.toThrow('wait expired')
      const start = cli.mark()
      await cli.waitForText('prompt> ', undefined, 0).write('n').waitForText('prompt> ', undefined, start).write('q')
      const result = await cli.waitForExit()
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('')
      expect(result.stderr).toBe('')
    } finally {
      await cli.dispose()
    }
  })
  it('marks distinguish prompts emitted in one chunk', async () => {
    const cli = spawnPty(dir(), [process.execPath, fixture, 'batch'])
    const start = cli.mark()
    await cli.waitForText('second')
    await cli.waitForText('first')
    await cli.waitForText('first', undefined, start)
    await cli.waitForExit()
  })
  it('early exit rejects an unmet wait, and write failures are awaited', async () => {
    const cli = spawnPty(dir(), [process.execPath, fixture, 'early'])
    await expect(cli.waitForText('never')).rejects.toThrow('exited')
    expect((await cli.waitForExit()).exitCode).toBe(7)
    await expect(cli.waitForText('finished', undefined, 0).write('late')).rejects.toThrow('closed PTY')
  })
  it('streams split Unicode in the combined transcript', async () => {
    const cli = spawnPty(dir(), [process.execPath, fixture, 'unicode'])
    await cli.waitForText('🌍')
    const result = await cli.waitForExit()
    expect(result.output).not.toContain('�')
    expect(result.output).toContain('終')
  })
})
