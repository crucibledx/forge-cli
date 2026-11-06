import {existsSync, readFileSync, writeFileSync} from 'node:fs'
import {join, resolve} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {expect, it} from 'bun:test'

import {spawnOwnedPipe} from '../e2e/framework/owned-pipe'
import {terminateTree} from '../e2e/framework/process'
import {createTestSandbox} from './test-sandbox'
import {repositoryRoot} from './validation-identity'
import {executeCheck} from './validation-process'

const dir = useTmpDir('validation-process')
const ports = {createSandbox: createTestSandbox, spawn: spawnOwnedPipe, terminate: terminateTree}
it('AC-25 setup failure returns a blocked diagnostic without spawning a command', async () => {
  let spawns = 0
  let setupBudget: number | undefined
  const result = await executeCheck(['unused'], 17, {
    ...ports,
    createSandbox: (_prefix, _base, timeout) => {
      setupBudget = timeout
      throw new Error('Cannot build isolated scheduler backend: fixture compiler failure')
    },
    spawn: async (...args) => {
      spawns++
      return spawnOwnedPipe(...args)
    },
  })
  expect(spawns).toBe(0)
  expect(setupBudget).toBe(17)
  expect(result).toMatchObject({exit_code: null, timed_out: false, stdout: '', stderr: ''})
  expect(result.reason).toContain('fixture compiler failure')
})
it.each(['tree', 'sandbox'] as const)(
  'AC-25 cleanup %s failure blocks passes without erasing known command failures',
  async (kind) => {
    for (const code of [0, 1, 2]) {
      const result = await executeCheck(
        [process.execPath, '-e', `process.stderr.write('original diagnostic');process.exit(${code})`],
        5000,
        {
          ...ports,
          createSandbox: (...args) => {
            const sandbox = createTestSandbox(...args)
            return {
              ...sandbox,
              dispose() {
                sandbox.dispose()
                if (kind === 'sandbox') throw new Error('fixture sandbox disposal failure')
              },
            }
          },
          terminate: async (child) => {
            await terminateTree(child)
            if (kind === 'tree') throw new Error('fixture process-group verification failure')
          },
        },
      )
      expect(result.exit_code).toBe(code === 0 ? null : code)
      expect(result.reason).toContain('Cleanup failed')
      expect(result.stderr).toBe('original diagnostic')
    }
  },
)
it.each([0, 1])('AC-25 diagnostic drain failure cannot pass or erase proven exit%s', async (code) => {
  const result = await executeCheck(['injected-process'], 5000, {
    ...ports,
    spawn: async () =>
      ({
        exited: Promise.resolve(code),
        stdout: new ReadableStream({
          start(controller) {
            setTimeout(() => controller.error(new Error('fixture diagnostic drain failure')), 10)
          },
        }),
        stderr: new ReadableStream({
          start(controller) {
            controller.close()
          },
        }),
      }) as Awaited<ReturnType<typeof spawnOwnedPipe>>,
    terminate: async () => {},
  })
  expect(result.exit_code).toBe(code === 0 ? null : code)
  expect(result.reason).toContain('fixture diagnostic drain failure')
})
it('AC-25 a proven failure survives a later pipe deadline', async () => {
  const result = await executeCheck(['injected-process'], 50, {
    ...ports,
    spawn: async () =>
      ({
        exited: Promise.resolve(1),
        stdout: new ReadableStream({
          start(controller) {
            controller.enqueue(Buffer.from('original failure'))
          },
        }),
        stderr: new ReadableStream({
          start(controller) {
            controller.close()
          },
        }),
      }) as Awaited<ReturnType<typeof spawnOwnedPipe>>,
    terminate: async () => {},
  })
  expect(result).toMatchObject({exit_code: 1, timed_out: true, stdout: 'original failure'})
  expect(result.reason).toContain('deadline')
})
it('AC-25,30,31 bounds a hanging command and preserves separate bounded failure diagnostics', async () => {
  const result = await executeCheck(
    [process.execPath, '-e', "process.stdout.write('out');process.stderr.write('err');setInterval(()=>{},1000)"],
    2000,
  )
  expect(result.timed_out).toBe(true)
  expect(result.exit_code).toBeNull()
  expect(result.stdout).toBe('out')
  expect(result.stderr).toBe('err')
  expect(result.duration_ms).toBeLessThan(5000)
})
it('AC-25 validation execution and HEAD lookup use the checkout authority, not caller working directories', async () => {
  const git = Bun.spawnSync(['git', '-C', repositoryRoot, 'rev-parse', 'HEAD'], {stdout: 'pipe', stderr: 'pipe'})
  expect(git.exitCode).toBe(0)
  const result = await executeCheck(
    [
      process.execPath,
      '-e',
      `import {actualHead} from ${JSON.stringify(join(import.meta.dir, 'validation-identity.ts'))};
process.stdout.write(process.cwd());process.chdir(${JSON.stringify(dir())});process.stderr.write(actualHead());`,
    ],
    5000,
  )
  expect(result).toMatchObject({exit_code: 0, timed_out: false, stdout: '<repository>'})
  expect(result.stderr).toBe(new TextDecoder().decode(git.stdout).trim())
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
      const result = await executeCheck([process.execPath, 'test', nested], 2000)
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
