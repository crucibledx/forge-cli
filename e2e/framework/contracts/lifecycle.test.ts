import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import {join} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {describe, expect, it} from 'bun:test'

import {testEnvironment} from '../../../scripts/test-sandbox'
import {spawnOwnedPipe} from '../owned-pipe'
import {runPipe} from '../pipe'
import {activeProcesses, disposeActiveProcesses, TAIL_BYTES, terminateTree} from '../process'
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
  it.skipIf(process.platform === 'win32')(
    'AC-18 stalled cleanup probes fail within budget and kill their descendants',
    async () => {
      const root = dir(),
        bin = join(root, 'bin'),
        pidfile = join(root, 'probe-child')
      mkdirSync(bin)
      writeFileSync(
        join(bin, 'ps'),
        `#!${process.execPath}\nconst child=Bun.spawn([process.execPath,'-e','setInterval(()=>{},1000)'],{stdin:'ignore',stdout:'inherit',stderr:'inherit'});await Bun.write(process.env.PS_PID_FILE,String(child.pid));await child.exited\n`,
        {mode: 0o755},
      )
      const env = testEnvironment(root, {PATH: `${bin}:${process.env.PATH}`, PS_PID_FILE: pidfile})
      const proc = await spawnOwnedPipe([process.execPath, '-e', 'process.exit(0)'], root, testEnvironment(root))
      expect(await proc.exited).toBe(0)
      const start = performance.now()
      await expect(terminateTree(proc, env)).rejects.toThrow('Cleanup probe exceeded remaining budget')
      expect(performance.now() - start).toBeLessThan(2500)
      expect(existsSync(pidfile)).toBe(true)
      expect(dead(Number(readFileSync(pidfile, 'utf8')))).toBe(true)
    },
  )
  it.skipIf(process.platform === 'win32')(
    'AC-18 a stalled supervisor probe reports exit within budget and leaves cleanup unverified',
    async () => {
      const root = dir(),
        bin = join(root, 'bin'),
        pidfile = join(root, 'probe-children')
      mkdirSync(bin)
      writeFileSync(
        join(bin, 'ps'),
        `#!${process.execPath}\nimport {appendFileSync} from 'node:fs'\nconst child=Bun.spawn([process.execPath,'-e','setInterval(()=>{},1000)'],{stdin:'ignore',stdout:'inherit',stderr:'inherit'});appendFileSync(process.env.PS_PID_FILE,child.pid+'\\n');await child.exited\n`,
        {mode: 0o755},
      )
      const env = testEnvironment(root, {PATH: `${bin}:${process.env.PATH}`, PS_PID_FILE: pidfile})
      const proc = await spawnOwnedPipe([process.execPath, '-e', 'process.exit(0)'], root, env)
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const exit = await Promise.race([
          proc.exited,
          new Promise<string>((resolve) => {
            timer = setTimeout(() => resolve('exit report stalled'), 6000)
          }),
        ])
        expect(exit).toBe(0)
        await expect(terminateTree(proc, env)).rejects.toThrow('Cleanup probe exceeded remaining budget')
      } finally {
        clearTimeout(timer)
        await terminateTree(proc, testEnvironment(root)).catch(() => {})
      }
      const children = readFileSync(pidfile, 'utf8').trim().split('\n').map(Number)
      expect(children.length).toBeGreaterThanOrEqual(2)
      for (const pid of children) expect(dead(pid)).toBe(true)
    },
  )
  it.each(
    ['exit', 'local-wait', 'total-deadline'].flatMap((mode) =>
      [
        'https://x:X_WAIT_PRIVATE',
        'https://fixture.invalid?to\x1b[31mken=X_WAIT_PRIVATE',
        'KNOWN_' + 'X_WAIT_PRIVATE'.repeat(80),
      ].map((wanted) => ({mode, wanted})),
    ),
  )('AC-15,18,27,30 direct PTY $mode rejection is a bounded private diagnostic', async ({mode, wanted}) => {
    if (process.platform === 'win32') return
    const cli = spawnPty(
      dir(),
      [
        process.execPath,
        '-e',
        "console.log('visible-wait-marker');" + (mode === 'exit' ? '' : 'setInterval(()=>{},1000)'),
      ],
      {timeoutMs: mode === 'total-deadline' ? 1000 : 5000, secrets: [wanted.startsWith('KNOWN_') ? wanted : '']},
    )
    let error: Error | undefined
    try {
      await cli.waitForText('visible-wait-marker')
      await cli.waitForText(wanted, mode === 'local-wait' ? 100 : undefined)
    } catch (value) {
      error = value as Error
    } finally {
      await cli.dispose()
    }
    expect(error).toBeInstanceOf(Error)
    for (const value of [error!.message, error!.stack!]) {
      expect(value).not.toContain('X_WAIT_PRIVATE')
      expect(value).toContain('visible-wait-marker')
      expect(Buffer.byteLength(value)).toBeLessThanOrEqual(TAIL_BYTES)
    }
    const context = JSON.parse(error!.message.split('\nSession: ')[1].split('\nTranscript tail:')[0])
    expect(context.cwd).toBe('.')
    expect(activeProcesses.size).toBe(0)
  })
  it.each([
    'assertion',
    'non-error',
    'cleanup',
    'large-output',
    'oversized-primary',
    'oversized-non-error',
    'oversized-cleanup',
    'noisy-deadline',
    'long-secret-summary',
  ])('AC-15,18,27,30 driver %s preserves private bounded failure context after cleanup', async (kind) => {
    const noisy = kind === 'noisy-deadline'
    const longSecret = 'PRIVATE_LONG_' + 'Q'.repeat(10000)
    const program = `process.stdout.write('Bearer AUTO_DRIVER_SECRET\\n' + 'é'.repeat(${kind === 'large-output' || noisy ? TAIL_BYTES : 0}) + '\\nBearer TAIL_DRIVER_SECRET\\nlast-driver-marker\\n');setInterval(()=>{},1000)`
    const cli = spawnPty(dir(), [process.execPath, '-e', program], {
      secrets: ['FIXTURE_SECRET', longSecret],
      ...(noisy ? {timeoutMs: 2000} : {}),
    })
    if (noisy) await cli.waitForText('last-driver-marker')
    const session =
      kind === 'cleanup' || kind === 'oversized-cleanup'
        ? {
            ...cli,
            dispose: async () => {
              await cli.dispose()
              throw new Error('cleanup detail\n' + (kind === 'oversized-cleanup' ? 'z'.repeat(40000) : ''))
            },
          }
        : cli
    let error: Error | undefined
    try {
      await driveSession(session, async (session) => {
        if (!noisy) await session.waitForText('last-driver-marker')
        if (noisy) await new Promise<void>(() => {})
        if (kind === 'oversized-non-error') throw 'primary driver assertion\n' + 'x'.repeat(40000)
        if (kind === 'oversized-primary') throw new TypeError('primary driver assertion\n' + 'é'.repeat(TAIL_BYTES * 2))
        if (kind === 'long-secret-summary') throw new TypeError('primary driver assertion ' + longSecret)
        if (kind === 'non-error') throw 'primary driver assertion token=DRIVER_VALUE'
        throw new TypeError('primary driver assertion FI\x1b[31mXTURE_SECRET\x1b[0m')
      })
    } catch (value) {
      error = value as Error
    }
    expect(error).toBeInstanceOf(Error)
    const primary = noisy ? 'Command deadline exceeded while driving session' : 'primary driver assertion'
    expect(error!.message).toContain(primary)
    expect(error!.message).toContain('last-driver-marker')
    expect(error!.message).toContain('[redacted]')
    if (kind === 'cleanup' || kind === 'oversized-cleanup') expect(error!.message).toContain('cleanup detail')
    if (!noisy && !['non-error', 'oversized-non-error'].includes(kind)) expect(error!.name).toBe('TypeError')
    const context = JSON.parse(error!.message.split('\nSession: ')[1].split('\nTranscript tail:')[0])
    expect(context.command).toEqual(['<runtime>', '-e', '<inline program>'])
    expect(context.cwd).toBe('.')
    expect(context.timedOut).toBe(noisy)
    expect(context.timeoutMs).toBe(noisy ? 2000 : 10000)
    for (const field of ['exit', 'signal', 'seed', 'replay']) expect(context).toHaveProperty(field)
    for (const view of [error!.message, error!.stack!]) {
      expect(view).toContain(primary)
      expect(view).toContain('last-driver-marker')
      expect(view).toContain('\nSession: ')
      expect(Buffer.byteLength(view)).toBeLessThanOrEqual(TAIL_BYTES)
      for (const secret of [
        'FIXTURE_SECRET',
        'AUTO_DRIVER_SECRET',
        'TAIL_DRIVER_SECRET',
        'DRIVER_VALUE',
        'PRIVATE_LONG_',
        'Q'.repeat(16),
        dir(),
        process.execPath,
      ])
        expect(view).not.toContain(secret)
    }
    expect(error!.cause).toBeUndefined()
    expect(activeProcesses.size).toBe(0)
  })
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
