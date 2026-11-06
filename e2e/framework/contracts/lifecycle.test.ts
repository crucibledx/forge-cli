import {existsSync, readFileSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {describe, expect, it} from 'bun:test'

import {runPipe} from '../pipe'
import {activeProcesses, disposeActiveProcesses} from '../process'
import {driveSession, runInitSession} from '../run'
import {spawnPty} from '../spawn'

const fixture = join(import.meta.dir, 'fixtures/process.ts')
function dead(pid: number): boolean {
  try {
    process.kill(pid, 0)
    const result = Bun.spawnSync(['ps', '-o', 'stat=', '-p', String(pid)], {stdout: 'pipe', stderr: 'pipe'})
    return new TextDecoder().decode(result.stdout).trim().startsWith('Z')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true
    throw error
  }
}

describe('BR-09 lifecycle contracts (AC-18)', () => {
  const dir = useTmpDir('lifecycle')
  it.each(['live-child', 'disposed-child'])('bounds a driver awaiting an unrelated promise after %s', async (kind) => {
    const cli = spawnPty(dir(), [process.execPath, fixture, 'hang'], {timeoutMs: 80})
    const result = driveSession(cli, async (session) => {
      if (kind === 'disposed-child') await session.dispose()
      await new Promise<void>(() => {})
    })
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const observed = await Promise.race([
        result.then(
          () => 'unexpected success',
          (error: Error) => error.message,
        ),
        new Promise<string>((resolve) => {
          timer = setTimeout(() => resolve('outer watchdog expired'), 3000)
        }),
      ])
      expect(observed).toContain('Command deadline exceeded')
      expect(observed).not.toContain('outer watchdog')
      expect(activeProcesses.size).toBe(0)
    } finally {
      clearTimeout(timer)
      await cli.dispose()
    }
  })
  it('bounds pipe and PTY hangs and cancels pending waits', async () => {
    const start = performance.now()
    const pipe = await runPipe(dir(), [process.execPath, fixture, 'hang'], {timeoutMs: 80})
    expect(pipe.timedOut).toBe(true)
    const cli = spawnPty(dir(), [process.execPath, fixture, 'hang'], {timeoutMs: 80})
    await expect(cli.waitForText('never')).rejects.toThrow('deadline')
    expect((await cli.waitForExit()).timedOut).toBe(true)
    expect(performance.now() - start).toBeLessThan(5000)
    expect(activeProcesses.size).toBe(0)
  })
  it('kills the leader and a SIGTERM-resistant descendant', async () => {
    const result = await runPipe(dir(), [process.execPath, fixture, 'descendant'], {timeoutMs: 2000})
    expect(result.timedOut).toBe(true)
    const pids = JSON.parse(result.output)
    expect(dead(pids.parent)).toBe(true)
    expect(dead(pids.child)).toBe(true)
  })
  it('cleans up driver assertions, cancellation and closed stdin', async () => {
    await expect(
      runInitSession(dir(), async () => {
        throw new Error('driver assertion')
      }),
    ).rejects.toThrow('driver assertion')
    expect(activeProcesses.size).toBe(0)
    const cli = spawnPty(dir(), [process.execPath, fixture, 'prompts'])
    await cli.waitForText('prompt> ').pressKey('\x03')
    expect((await cli.waitForExit()).exitCode).toBe(0)
    expect((await runPipe(dir(), [process.execPath, fixture, 'eof'])).stdout).toBe('eof:\n')
  })
  it('afterEach cleanup owns a session abandoned by a shorter nested runner timeout', async () => {
    const nested = join(dir(), 'nested.test.ts')
    const pidFile = join(dir(), 'pids.json')
    const spawn = join(import.meta.dir, '../spawn.ts')
    writeFileSync(
      nested,
      `
import {it, beforeAll} from 'bun:test'
import {spawnPty} from ${JSON.stringify(spawn)}
beforeAll(async () => {
 const cli = spawnPty(${JSON.stringify(dir())}, [process.execPath, ${JSON.stringify(fixture)}, 'descendant', ${JSON.stringify(pidFile)}])
 await cli.waitForText('parent')
}, 5000)
it('intentional runner timeout after fixture readiness', async () => {
 await new Promise(() => {})
}, 200)
`,
    )
    const result = await runPipe(dir(), [process.execPath, 'test', nested], {timeoutMs: 10000})
    expect(result.exitCode).not.toBe(0)
    expect(result.timedOut).toBe(false)
    expect(existsSync(pidFile)).toBe(true)
    const pids = JSON.parse(readFileSync(pidFile, 'utf8'))
    expect(dead(pids.parent)).toBe(true)
    expect(dead(pids.child)).toBe(true)
  })
  it('teardown is idempotent and cancels a live wait', async () => {
    const cli = spawnPty(dir(), [process.execPath, fixture, 'hang'])
    const waiting = cli.waitForText('never').catch((error: Error) => error)
    await disposeActiveProcesses()
    expect(((await waiting) as Error).message).toContain('closed')
    await cli.dispose()
    expect(activeProcesses.size).toBe(0)
  })
})
