import {expect, it, spyOn} from 'bun:test'

import {type OwnedProcess, terminateTree} from '../process'

it.each(['zombie-only', 'live-denial', 'unverifiable'])(
  'AC-18 durable cleanup only tolerates EPERM for a proved dead group: %s',
  async (kind) => {
    if (process.platform === 'win32') return
    const pid = 123456789
    const denied = Object.assign(new Error('permission denied'), {code: 'EPERM'})
    const signal = spyOn(process, 'kill').mockImplementation(() => {
      throw denied
    })
    const snapshot = spyOn(Bun, 'spawnSync').mockReturnValue({
      pid: 1,
      exitCode: kind === 'unverifiable' ? 1 : 0,
      stdout: Buffer.from(`${pid} ${kind === 'zombie-only' ? 'Z' : 'S'}\n`),
      stderr: Buffer.from(''),
      success: kind !== 'unverifiable',
    } as ReturnType<typeof Bun.spawnSync>)
    const proc = {pid, exited: Promise.resolve(0)} as OwnedProcess
    try {
      if (kind === 'zombie-only') await expect(terminateTree(proc, {})).resolves.toBeUndefined()
      else
        await expect(terminateTree(proc, {})).rejects.toThrow(
          kind === 'live-denial' ? 'permission denied' : 'Cannot verify',
        )
      expect(snapshot).toHaveBeenCalled()
      expect(snapshot.mock.calls[0][1]).toEqual({env: {}, stdout: 'pipe', stderr: 'pipe'})
    } finally {
      signal.mockRestore()
      snapshot.mockRestore()
    }
  },
)
