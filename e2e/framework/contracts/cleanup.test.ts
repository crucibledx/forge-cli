import {expect, it, spyOn} from 'bun:test'

import {type OwnedProcess, terminateTree} from '../process'

it.each(['SIGTERM', 'SIGKILL'] as const)(
  'AC-18 transient EPERM at %s must prove the orphan became dead within the original cleanup budget',
  async (stage) => {
    if (process.platform === 'win32') return
    const pid = 123456789
    const denied = Object.assign(new Error('transient orphan permission denial'), {code: 'EPERM'})
    const gone = Object.assign(new Error('no such process'), {code: 'ESRCH'})
    const signal = spyOn(process, 'kill').mockImplementation((group, value) => {
      if (group === -(pid + 1)) throw gone
      if (group === -pid && value === stage) throw denied
      return true
    })
    let snapshots = 0
    const snapshot = spyOn(Bun, 'spawn').mockImplementation(
      () =>
        ({
          pid: pid + 1,
          exitCode: 0,
          exited: Promise.resolve(0),
          stdout: new Response(`${pid} ${++snapshots === 1 ? 'S' : 'Z'}\n`).body,
        }) as ReturnType<typeof Bun.spawn>,
    )
    const proc = {pid, exited: Promise.resolve(0)} as OwnedProcess
    try {
      await expect(terminateTree(proc, {})).resolves.toBeUndefined()
      expect(snapshots).toBeGreaterThanOrEqual(2)
      expect(signal.mock.calls.filter(([group, value]) => group === -pid && value === stage)).toHaveLength(2)
    } finally {
      signal.mockRestore()
      snapshot.mockRestore()
    }
  },
)

it.each(['zombie-only', 'live-denial', 'unverifiable'])(
  'AC-18 durable cleanup only tolerates EPERM for a proved dead group: %s',
  async (kind) => {
    if (process.platform === 'win32') return
    const pid = 123456789
    const denied = Object.assign(new Error('permission denied'), {code: 'EPERM'})
    const gone = Object.assign(new Error('no such process'), {code: 'ESRCH'})
    const signal = spyOn(process, 'kill').mockImplementation((group) => {
      if (group === -(pid + 1)) throw gone
      if (group === -pid) throw denied
      return true
    })
    const snapshot = spyOn(Bun, 'spawn').mockImplementation(
      () =>
        ({
          pid: pid + 1,
          exitCode: kind === 'unverifiable' ? 1 : 0,
          exited: Promise.resolve(kind === 'unverifiable' ? 1 : 0),
          stdout: new Response(`${pid} ${kind === 'zombie-only' ? 'Z' : 'S'}\n`).body,
        }) as ReturnType<typeof Bun.spawn>,
    )
    const proc = {pid, exited: Promise.resolve(0)} as OwnedProcess
    try {
      if (kind === 'zombie-only') await expect(terminateTree(proc, {})).resolves.toBeUndefined()
      else
        await expect(terminateTree(proc, {})).rejects.toThrow(
          kind === 'live-denial' ? 'permission denied' : 'Cannot verify',
        )
      expect(snapshot).toHaveBeenCalled()
      expect(snapshot.mock.calls[0][1]).toEqual({
        env: {},
        detached: true,
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'ignore',
      })
    } finally {
      signal.mockRestore()
      snapshot.mockRestore()
    }
  },
)

it.each([
  ['drains', 'Cleanup probe exceeded remaining budget'],
  ['survives', 'Cleanup probe exceeded remaining budget; Cleanup probe descendants survived within remaining budget'],
])('AC-18 a stalled cleanup probe waits for its killed group to empty: %s', async (kind, message) => {
  if (process.platform === 'win32') return
  const pid = 123456789,
    probePid = pid + 1
  const gone = Object.assign(new Error('no such process'), {code: 'ESRCH'})
  let release = () => {}
  const exited = new Promise<number>((resolve) => {
    release = () => resolve(137)
  })
  let groupChecks = 0
  const signal = spyOn(process, 'kill').mockImplementation((group, value) => {
    if (group === -pid) throw gone
    if (group === -probePid && value === 'SIGKILL') release()
    if (group === -probePid && value === 0 && ++groupChecks > 2 && kind === 'drains') throw gone
    return true
  })
  const snapshot = spyOn(Bun, 'spawn').mockImplementation(
    () => ({pid: probePid, exitCode: null, exited, stdout: new ReadableStream()}) as ReturnType<typeof Bun.spawn>,
  )
  const proc = {pid, exited: Promise.resolve(0)} as OwnedProcess
  try {
    const start = performance.now()
    const error = await terminateTree(proc, {}).then(
      () => undefined,
      (reason: Error) => reason,
    )
    expect(error?.message).toBe(message)
    expect(performance.now() - start).toBeLessThan(2500)
    if (kind === 'drains') expect(groupChecks).toBe(3)
    else expect(groupChecks).toBeGreaterThan(3)
  } finally {
    signal.mockRestore()
    snapshot.mockRestore()
  }
})
