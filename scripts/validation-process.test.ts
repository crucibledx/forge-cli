import {existsSync, readFileSync, writeFileSync} from 'node:fs'
import {join, resolve} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {describe, expect, it} from 'bun:test'

import {spawnOwnedPipe} from '../e2e/framework/owned-pipe'
import {runPipe} from '../e2e/framework/pipe'
import {TAIL_BYTES, terminateTree} from '../e2e/framework/process'
import {createTestSandbox, testEnvironment} from './test-sandbox'
import type {StructuredCommandOutput} from './validation-process'
import {executeCheck, MAX_STRUCTURED_BYTES} from './validation-process'

const dir = useTmpDir('validation-process')
const ports = {createSandbox: createTestSandbox, spawn: spawnOwnedPipe, terminate: terminateTree}
it.each(['split-utf8', 'beyond-tail', 'at-cap', 'over-cap', 'invalid-utf8', 'trailing-garbage', 'empty'])(
  'AC-27,30 private structured stdout is complete, bounded and independent of diagnostics: %s',
  async (kind) => {
    const json = Buffer.from('{"public":"λ","access_token":"STRUCTURED_PRIVATE_Q"}')
    let chunks: Uint8Array[]
    if (kind === 'split-utf8') chunks = Array.from(json, (byte) => Uint8Array.of(byte))
    else if (kind === 'beyond-tail') chunks = [json, Buffer.alloc(TAIL_BYTES + 1, ' ')]
    else if (kind === 'at-cap') chunks = [json, Buffer.alloc(MAX_STRUCTURED_BYTES - json.length, ' ')]
    else if (kind === 'over-cap') chunks = [json, Buffer.alloc(MAX_STRUCTURED_BYTES + 1 - json.length, ' ')]
    else if (kind === 'invalid-utf8') chunks = [Buffer.from('{"public":"'), Uint8Array.of(0xff), Buffer.from('"}')]
    else if (kind === 'trailing-garbage') chunks = [json, Buffer.from('not-json')]
    else chunks = []
    const stream = (values: Uint8Array[]) =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          for (const value of values) controller.enqueue(value)
          controller.close()
        },
      })
    const structured: StructuredCommandOutput = {data: {public: 'stale-result'}}
    const result = await executeCheck(
      ['fixture-structured'],
      5000,
      {
        ...ports,
        spawn: async () =>
          ({
            exited: Promise.resolve(0),
            stdout: stream(chunks),
            stderr: stream([Buffer.from('Bearer STDERR_PRIVATE_Q')]),
          }) as unknown as Awaited<ReturnType<typeof spawnOwnedPipe>>,
        terminate: async () => {},
      },
      structured,
    )
    expect(result).toMatchObject({exit_code: 0, timed_out: false})
    if (['split-utf8', 'beyond-tail', 'at-cap'].includes(kind))
      expect(structured.data).toEqual({public: 'λ', access_token: 'STRUCTURED_PRIVATE_Q'})
    else expect(structured.data).toBeUndefined()
    const output = JSON.stringify(result)
    expect(output).not.toContain('STRUCTURED_PRIVATE_Q')
    expect(output).not.toContain('STDERR_PRIVATE_Q')
    expect(output).not.toContain('stale-result')
    expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(TAIL_BYTES)
  },
)
describe('repository-local private validation roots', () => {
  const nested = useTmpDir('validation-process-nested', import.meta.dir)
  it('AC-27 nested native Git paths stay private in both streams and cleanup failures', async () => {
    const script = `
      import {dirname, join} from 'node:path'
      const project = join(dirname(process.env.HOME), 'project')
      const git = (...args) => Bun.spawnSync(['git', '-C', project, ...args], {stdout:'pipe', stderr:'pipe'})
      if (git('init', '--quiet').exitCode !== 0) throw Error('Fixture Git init failed')
      const result = git('rev-parse', '--show-toplevel')
      if (result.exitCode !== 0) throw Error('Fixture Git path lookup failed')
      const output = JSON.stringify({path: result.stdout.toString().trim(), repository: process.cwd(), public: 'PUBLIC_NESTED_Q'})
      process.stdout.write(output); process.stderr.write(output); process.exit(19)
    `
    const result = await executeCheck([process.execPath, '-e', script], 5000, {
      ...ports,
      createSandbox: (prefix, _base, timeout) => {
        const sandbox = createTestSandbox(prefix, nested(), timeout)
        return {
          ...sandbox,
          dispose() {
            sandbox.dispose()
            throw new Error(`fixture cleanup failure at ${sandbox.root}`)
          },
        }
      },
    })
    expect(result).toMatchObject({exit_code: 19, timed_out: false})
    for (const output of [result.stdout, result.stderr]) {
      expect(JSON.parse(output)).toEqual({
        path: join('<sandbox>', 'project'),
        repository: '<repository>',
        public: 'PUBLIC_NESTED_Q',
      })
      expect(output).not.toContain('forge-validation-')
    }
    expect(result.reason).toContain('fixture cleanup failure at <sandbox>')
    expect(result.reason).not.toContain('forge-validation-')
  })
})
it('AC-27 failed command artifacts remove native, escaped and expanded Windows sandbox aliases', async () => {
  const root = String.raw`C:\Users\RUNNER~1\AppData\Local\Temp\forge-validation-private-alias`
  const aliases = [
    root,
    root.replaceAll('\\', '/'),
    String.raw`C:\Users\PRIVATE_USER_Q\AppData\Local\Temp\forge-validation-private-alias`,
    String.raw`c:\users\PRIVATE_USER_Q\appdata\local\temp\forge-validation-private-alias`,
  ].flatMap((path) => [path, path.replaceAll('\\', '\\\\')])
  const input =
    aliases
      .map(
        (path) =>
          `PUBLIC_BEFORE_ALIAS "D:\\public\\keep.txt" "https://public.invalid/keep" failure at "${path}\\nested\\file" PUBLIC_SAME_LINE`,
      )
      .join('\n') + '\nPUBLIC_AFTER_ALIAS'
  const stream = () =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Buffer.from(input))
        controller.close()
      },
    })
  const result = await executeCheck(['fixture'], 5000, {
    ...ports,
    createSandbox: () => {
      const sandbox = createTestSandbox()
      return {...sandbox, root, dispose: sandbox.dispose}
    },
    spawn: async () =>
      ({
        exited: Promise.resolve(19),
        stdout: stream(),
        stderr: stream(),
      }) as unknown as Awaited<ReturnType<typeof spawnOwnedPipe>>,
    terminate: async () => {},
  })
  expect(result.exit_code).toBe(19)
  expect(result.timed_out).toBe(false)
  for (const output of [result.stdout, result.stderr]) {
    expect(output).not.toContain('PRIVATE_USER_Q')
    expect(output).not.toContain('RUNNER~1')
    expect(output).not.toContain('forge-validation-private-alias')
    expect(output).toContain('PUBLIC_AFTER_ALIAS')
    expect(output).toContain('PUBLIC_BEFORE_ALIAS')
    expect(output).toContain('PUBLIC_SAME_LINE')
    expect(output).toContain('public.invalid/keep')
    expect(output).toContain('<sandbox>')
  }
  expect(result.stdout).toContain('"D:\\public\\keep.txt"')
  expect(result.stderr).toContain('"D:\\public\\keep.txt"')
  for (const output of [result.stdout, result.stderr]) {
    const lines = output.split('\n')
    expect(lines).toHaveLength(aliases.length + 1)
    for (const line of lines.slice(0, -1)) {
      expect(line).toContain('PUBLIC_BEFORE_ALIAS')
      expect(line).toContain('"D:\\public\\keep.txt"')
      expect(line).toContain('"https://public.invalid/keep"')
      expect(line).toContain('PUBLIC_SAME_LINE')
      expect(line).toContain('<sandbox>')
    }
  }
})
it('AC-27 native Git-expanded paths in failed stdout and stderr are private after disposal', async () => {
  const script = `
    import {dirname, join} from 'node:path'
    const repository = join(dirname(process.env.HOME), 'project')
    const git = (...args) => Bun.spawnSync(['git', '-C', repository, ...args], {stdout:'pipe', stderr:'pipe'})
    if (git('init', '--quiet').exitCode !== 0) throw Error('Fixture Git init failed')
    const result = git('rev-parse', '--show-toplevel')
    if (result.exitCode !== 0) throw Error('Fixture Git path lookup failed')
    const value = JSON.stringify({path: result.stdout.toString().trim(), public: 'PUBLIC_NATIVE_Q'})
    process.stdout.write(value)
    process.stderr.write(value)
    process.exit(19)
  `
  const result = await executeCheck([process.execPath, '-e', script], 5000)
  expect(result).toMatchObject({exit_code: 19, timed_out: false})
  for (const output of [result.stdout, result.stderr]) {
    expect(JSON.parse(output)).toEqual({path: join('<sandbox>', 'project'), public: 'PUBLIC_NATIVE_Q'})
    expect(output).not.toContain('forge-validation-')
  }
})
it.each([
  {command: ['bun', 'run', 'fixture'], expected: [process.execPath, '--no-env-file', 'run', 'fixture']},
  {command: [process.execPath, '-e', '0'], expected: [process.execPath, '--no-env-file', '-e', '0']},
  {command: ['dist/forge', '--version'], expected: ['dist/forge', '--version']},
  {command: ['git', '--version'], expected: ['git', '--version']},
])('AC-19 Bun-only dotenv flags preserve compiled and non-Bun arguments: $command', async ({command, expected}) => {
  let actual: string[] | undefined
  const closed = () =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close()
      },
    })
  const result = await executeCheck([...command], 5000, {
    ...ports,
    spawn: async (args) => {
      actual = args
      return {
        exited: Promise.resolve(0),
        stdout: closed(),
        stderr: closed(),
      } as unknown as Awaited<ReturnType<typeof spawnOwnedPipe>>
    },
    terminate: async () => {},
  })
  expect(result.exit_code).toBe(0)
  expect(actual).toEqual([...expected])
})
it('AC-19 validation cleanup receives the command sandbox, never the launcher startup environment', async () => {
  if (process.platform === 'win32') return
  const root = dir(),
    observed = join(root, 'cleanup-environment.json'),
    childEnvironment = join(root, 'child-environment.json')
  const script = `
    import {executeCheck} from ${JSON.stringify(join(import.meta.dir, 'validation-process.ts'))}
    import {createTestSandbox} from ${JSON.stringify(join(import.meta.dir, 'test-sandbox.ts'))}
    import {spawnOwnedPipe} from ${JSON.stringify(resolve(import.meta.dir, '../e2e/framework/owned-pipe.ts'))}
    import {terminateTree} from ${JSON.stringify(resolve(import.meta.dir, '../e2e/framework/process.ts'))}
    import {writeFileSync} from 'node:fs'
    const result = await executeCheck([process.execPath, '-e',
      ${JSON.stringify(`import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(childEnvironment)},JSON.stringify({home:process.env.HOME,temp:process.env.TMPDIR}));setInterval(()=>{},1000)`)}], 750, {
        createSandbox:createTestSandbox,spawn:spawnOwnedPipe,
        terminate:async(proc,env)=>{
          writeFileSync(${JSON.stringify(observed)},JSON.stringify({
            marker:env.CLEANUP_STARTUP_PRIVATE??'unset',home:env.HOME,temp:env.TMPDIR
          }))
          await terminateTree(proc,env)
        }
      })
    if (!result.timed_out || result.reason?.includes('Cleanup failed:')) {
      console.error(JSON.stringify(result))
      process.exitCode = 1
    }
  `
  const result = await runPipe(root, [process.execPath, '-e', script], {
    timeoutMs: 5000,
    env: {
      CLEANUP_STARTUP_PRIVATE: 'SYNTHETIC_LAUNCHER_PRIVATE',
    },
  })
  expect(result.exitCode).toBe(0)
  const child = JSON.parse(readFileSync(childEnvironment, 'utf8'))
  expect(child.home).not.toBe(testEnvironment(root).HOME)
  const cleanup = JSON.parse(readFileSync(observed, 'utf8'))
  expect(cleanup).toEqual({marker: 'unset', home: child.home, temp: child.temp})
})
it.each(['setup-error', 'setup-string', 'cleanup-error', 'cleanup-string'])(
  'AC-15,18,25,27,30 oversized %s keeps a private bounded primary reason',
  async (kind) => {
    const message = 'primary unavailable https://user:X_SETUP_PRIVATE\n' + 'é'.repeat(TAIL_BYTES * 2)
    const thrown = kind.endsWith('string') ? message : new Error(message)
    const result = await executeCheck([process.execPath, '-e', "console.log('visible-child')"], 5000, {
      ...ports,
      createSandbox: () => {
        if (kind.startsWith('setup')) throw thrown
        return createTestSandbox()
      },
      terminate: async (child, env) => {
        await terminateTree(child, env)
        throw thrown
      },
    })
    expect(result.reason).toContain('primary unavailable')
    expect(result.reason).not.toContain('X_SETUP_PRIVATE')
    expect(Buffer.byteLength(result.reason!)).toBeLessThanOrEqual(16000)
    expect(JSON.stringify(result)).not.toContain('X_SETUP_PRIVATE')
    expect(result.exit_code).toBeNull()
    if (kind.startsWith('cleanup')) expect(result.stdout).toContain('visible-child')
  },
)
it.each(['nonzero-exit', 'zero-exit', 'exit-after-deadline'])(
  'AC-18,25,27 keeps the exit observed before cleanup: %s',
  async (kind) => {
    let finish!: (code: number) => void
    const closed = () =>
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.close()
        },
      })
    const child = {
      exited:
        kind === 'exit-after-deadline'
          ? new Promise<number>((resolve) => {
              finish = resolve
            })
          : Promise.resolve(kind === 'nonzero-exit' ? 143 : 0),
      stdout: closed(),
      stderr: closed(),
    } as unknown as Awaited<ReturnType<typeof spawnOwnedPipe>>
    const result = await executeCheck(['injected-exit'], kind === 'exit-after-deadline' ? 30 : 5000, {
      ...ports,
      spawn: async () => child,
      terminate: async () => {
        finish?.(137)
      },
    })
    expect(result).toMatchObject({
      exit_code: kind === 'exit-after-deadline' ? null : kind === 'nonzero-exit' ? 143 : 0,
      timed_out: kind === 'exit-after-deadline',
    })
  },
)
it.each(['SIGTERM', 'SIGKILL'])(
  'AC-18,25,27 real command killed by %s keeps a failing exit independently of owned cleanup',
  async (signal) => {
    if (process.platform === 'win32') return
    const result = await executeCheck(
      [process.execPath, '-e', `process.stderr.write('before-signal');process.kill(process.pid, '${signal}')`],
      5000,
    )
    expect(result.exit_code).not.toBe(0)
    expect(result.exit_code).not.toBeNull()
    expect(result.timed_out).toBe(false)
    expect(result.stderr).toBe('before-signal')
  },
)
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
          terminate: async (child, env) => {
            await terminateTree(child, env)
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
  const start = performance.now()
  const result = await executeCheck(
    [process.execPath, '-e', "process.stdout.write('out');process.stderr.write('err');setInterval(()=>{},1000)"],
    2000,
  )
  expect(result.timed_out).toBe(true)
  expect(result.exit_code).toBeNull()
  expect(result.stdout).toBe('out')
  expect(result.stderr).toBe('err')
  expect(performance.now() - start).toBeLessThan(5000)
})
it('AC-25 validation execution uses the checkout authority, not caller working directories', async () => {
  const result = await executeCheck([process.execPath, '-e', 'process.stdout.write(process.cwd())'], 5000)
  expect(result).toMatchObject({exit_code: 0, timed_out: false, stdout: '<repository>'})
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
