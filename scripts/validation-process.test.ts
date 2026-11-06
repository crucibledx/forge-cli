import {existsSync, readFileSync, writeFileSync} from 'node:fs'
import {join, resolve} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {expect, it} from 'bun:test'

import {executeCheck} from './validation-process'

const dir = useTmpDir('validation-process')
it('AC-25,30,31 bounds a hanging command and preserves separate bounded failure diagnostics', async () => {
  const result = await executeCheck(
    [process.execPath, '-e', "process.stdout.write('out');process.stderr.write('err');setInterval(()=>{},1000)"],
    dir(),
    2000,
  )
  expect(result.timed_out).toBe(true)
  expect(result.exit_code).toBeNull()
  expect(result.stdout).toBe('out')
  expect(result.stderr).toBe('err')
  expect(result.duration_ms).toBeLessThan(5000)
})
it.each(['pipe', 'pty'])(
  'AC-18,19,25 outer deadline reaps detached %s descendants after hard-killing their runner',
  async (mode) => {
    if (process.platform === 'win32') return // Native Job Object ownership has its separate Windows fixture.
    const root = dir(),
      nested = join(root, 'outer-killed.test.ts'),
      pidsPath = join(root, 'pids.json')
    const fixture = resolve(import.meta.dir, '../e2e/framework/contracts/fixtures/process.ts')
    const module = resolve(import.meta.dir, `../e2e/framework/${mode === 'pipe' ? 'pipe' : 'spawn'}.ts`)
    writeFileSync(
      nested,
      `
import {it} from 'bun:test'
import {${mode === 'pipe' ? 'runPipe' : 'spawnPty'}} from ${JSON.stringify(module)}
process.on('SIGTERM', () => process.kill(process.pid, 'SIGKILL'))
it('runner dies before its own cleanup and ten-second session deadline', async () => {
 const command = [process.execPath, ${JSON.stringify(fixture)}, 'descendant', ${JSON.stringify(pidsPath)}]
 ${mode === 'pipe' ? `await runPipe(${JSON.stringify(root)}, command)` : `const cli = spawnPty(${JSON.stringify(root)}, command); await cli.waitForText('parent'); await new Promise(() => {})`}
}, 30000)
`,
    )
    let pids: {parent: number; child: number} | undefined
    const dead = (pid: number) => {
      const value = Bun.spawnSync(['ps', '-o', 'stat=', '-p', String(pid)], {stdout: 'pipe', stderr: 'pipe'})
      return value.exitCode !== 0 || new TextDecoder().decode(value.stdout).trim().startsWith('Z')
    }
    try {
      const result = await executeCheck([process.execPath, 'test', nested], root, 2000)
      expect(result.timed_out).toBe(true)
      expect(result.exit_code).toBeNull()
      expect(existsSync(pidsPath)).toBe(true)
      pids = JSON.parse(readFileSync(pidsPath, 'utf8'))
      const end = performance.now() + 2000
      while ((!dead(pids!.parent) || !dead(pids!.child)) && performance.now() < end)
        await new Promise((resolve) => setTimeout(resolve, 10))
      expect(dead(pids!.parent)).toBe(true)
      expect(dead(pids!.child)).toBe(true)
    } finally {
      if (pids)
        for (const pid of [pids.parent, pids.child])
          try {
            process.kill(pid, 'SIGKILL')
          } catch {}
    }
  },
)
