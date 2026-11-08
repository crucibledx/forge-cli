import {useTmpDir} from '@test-helpers/tmp'
import {expect, it, spyOn} from 'bun:test'

import {runPipe} from '../pipe'
import {activeProcesses, TAIL_BYTES} from '../process'
import {spawnPty} from '../spawn'

const dir = useTmpDir('session-denial')
it.each(['pipe', 'pty'])(
  'AC-18 public %s exit wait settles on persistent live signal denial without an exit notification',
  async (kind) => {
    if (process.platform === 'win32') return
    const nativeSpawn = Bun.spawn,
      nativeKill = process.kill.bind(process)
    const children: Bun.Subprocess[] = []
    const probes: Bun.Subprocess[] = []
    const unreported = new Promise<number>(() => {})
    const spawn = spyOn(Bun, 'spawn').mockImplementation(((...args: unknown[]) => {
      const child = Reflect.apply(nativeSpawn, Bun, args) as Bun.Subprocess
      if (Array.isArray(args[0]) && args[0][0] === 'ps') {
        probes.push(child)
        return child
      }
      children.push(child)
      // Inject loss of exit observation, not an already-completed fake child.
      return new Proxy(child, {
        get(target, key) {
          if (key === 'exited') return unreported
          const value = Reflect.get(target, key)
          return typeof value === 'function' ? value.bind(target) : value
        },
      })
    }) as typeof Bun.spawn)
    const denied = Object.assign(new Error('persistent live owned-group permission denial'), {code: 'EPERM'})
    let attempts = 0
    const signal = spyOn(process, 'kill').mockImplementation((pid, value) => {
      if (children.some((child) => pid === -child.pid)) {
        attempts++
        throw denied
      }
      return nativeKill(pid, value)
    })
    const command = [
      process.execPath,
      '-e',
      "process.on('SIGHUP',()=>{});console.log('STDOUT_FAILURE_REASON token=DENIAL_PRIVATE');console.error('STDERR_FAILURE_REASON');setInterval(()=>{},1000)",
    ]
    const options = {timeoutMs: 150, env: {FC_SEED: '123', FC_PATH: '0:1'}}
    const started = performance.now()
    let watchdog: ReturnType<typeof setTimeout> | undefined
    try {
      const pending =
        kind === 'pipe' ? runPipe(dir(), command, options) : spawnPty(dir(), command, options).waitForExit()
      const outcome = await Promise.race([
        pending.then(
          () => 'unexpected success',
          (error: Error) => error,
        ),
        new Promise<string>((resolve) => {
          watchdog = setTimeout(() => resolve('outer watchdog expired'), 5000)
        }),
      ])
      expect(outcome).toBeInstanceOf(Error)
      expect((outcome as Error).message).toContain('persistent live owned-group permission denial')
      for (const text of [(outcome as Error).message, (outcome as Error).stack!]) {
        expect(text).toContain('STDOUT_FAILURE_REASON')
        expect(text).toContain('STDERR_FAILURE_REASON')
        expect(text).not.toContain('DENIAL_PRIVATE')
        expect(text).not.toContain(dir())
        expect(Buffer.byteLength(text)).toBeLessThanOrEqual(TAIL_BYTES)
      }
      const context = JSON.parse((outcome as Error).message.split('\nSession: ')[1].split('\nTranscript tail:')[0])
      expect(context).toMatchObject({
        cwd: '.',
        exit: null,
        signal: null,
        timedOut: true,
        timeoutMs: 150,
        seed: '123',
        replay: '0:1',
      })
      expect(context.command).toEqual(['<runtime>', '-e', '<inline program>'])
      expect(performance.now() - started).toBeLessThan(4000)
      expect(attempts).toBeGreaterThan(1)
      expect(children).toHaveLength(1)
      expect(probes.length).toBeGreaterThan(0)
      for (const probe of probes) {
        expect([0, 137]).toContain(await probe.exited)
        if (probe.exitCode !== 0) expect(probe.signalCode).toBe('SIGKILL')
      }
      expect(activeProcesses.size).toBe(0)
    } finally {
      clearTimeout(watchdog)
      signal.mockRestore()
      spawn.mockRestore()
      // Restore actual signalling before killing/reaping every real owned fixture.
      for (const child of children) {
        try {
          nativeKill(-child.pid, 'SIGKILL')
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error
        }
        let reap: ReturnType<typeof setTimeout> | undefined
        try {
          await Promise.race([
            child.exited,
            new Promise((_, reject) => {
              reap = setTimeout(() => reject(new Error('Real fixture did not reap')), 3000)
            }),
          ])
        } finally {
          clearTimeout(reap)
        }
      }
    }
  },
)
