import {chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import {dirname, join, resolve} from 'node:path'

import {describe, expect, it} from 'bun:test'

import {runPipe} from '../e2e/framework/pipe'
import {useTmpDir} from '../src/test-helpers/tmp'
import type {createTestSandbox} from './test-sandbox'
import {testEnvironment} from './test-sandbox'

describe('isolated launcher regressions (BR-09,10)', () => {
  const dir = useTmpDir('launcher-contracts')
  it.each([true, false])(
    'AC-25 observed failed=%s retains failure precedence when actual sandbox removal fails',
    async (failed) => {
      if (process.platform === 'win32') return
      const record = join(dir(), 'cleanup-record.json')
      const fixture = join(dir(), 'cleanup.test.ts')
      writeFileSync(
        fixture,
        `
import {it, expect} from 'bun:test'
import {mkdirSync, writeFileSync, chmodSync} from 'node:fs'
import {join, dirname} from 'node:path'
it('known observed test outcome', () => {
 const denied = join(process.env.TMPDIR, 'cannot-remove')
 mkdirSync(denied)
 writeFileSync(join(denied, 'sentinel'), 'owned cleanup fixture')
 writeFileSync(${JSON.stringify(record)}, JSON.stringify({sandbox: dirname(process.env.TMPDIR), denied}))
 chmodSync(denied, 0o500)
 expect(${failed}).toBe(false)
})
`,
      )
      try {
        const result = await runPipe(dir(), [process.execPath, resolve(import.meta.dir, 'run-tests.ts'), '--', fixture])
        expect(result.timedOut).toBe(false)
        expect(result.exitCode).toBe(failed ? 1 : 2)
        expect(result.stderr).toContain(failed ? '1 fail' : '1 pass')
        expect(result.stderr).toMatch(/EACCES|EPERM|ENOTEMPTY/)
      } finally {
        if (existsSync(record)) {
          const owned = JSON.parse(readFileSync(record, 'utf8'))
          expect(dirname(owned.sandbox)).toBe(testEnvironment(dir()).TMPDIR)
          if (existsSync(owned.denied)) chmodSync(owned.denied, 0o700)
          rmSync(owned.sandbox, {recursive: true, force: true})
        }
      }
    },
  )
  it('AC-25 suite selection uses the registry and still rejects unknown flags/suites', async () => {
    const launcher = resolve(import.meta.dir, 'run-tests.ts')
    for (const args of [['--suite', 'unknown'], ['--arbitrary'], ['--suite', 'unit', 'extra']]) {
      expect((await runPipe(dir(), [process.execPath, launcher, ...args])).exitCode).toBe(2)
    }
    const valid = await runPipe(dir(), [process.execPath, launcher, '--suite', 'properties'])
    expect(valid.exitCode).toBe(0)
    expect(valid.stderr).toContain('6 pass')
  })
  it('separates global module mocks from real safety modules, independent of file order', async () => {
    const suite = join(dir(), 'suite')
    mkdirSync(suite)
    writeFileSync(join(suite, 'value.ts'), 'export const value = 1\n')
    writeFileSync(
      join(suite, 'a.test.ts'),
      `import {mock,it,expect} from 'bun:test'
mock.module('./value', () => ({value: 2}))
it('mocked', async () => expect((await import('./value')).value).toBe(2))\n`,
    )
    writeFileSync(
      join(suite, 'b.test.ts'),
      `import {it,expect} from 'bun:test'
import {value} from './value'
it('unmocked', () => expect(value).toBe(1))\n`,
    )
    const result = await runPipe(dir(), [process.execPath, resolve(import.meta.dir, 'run-tests.ts'), '--', suite])
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toContain('(pass) mocked')
    expect(result.stderr).toContain('(pass) unmocked')
  })
  it('imports local fixture history with no configured identity', async () => {
    const fixture = join(dir(), 'identity.test.ts')
    const helper = resolve(import.meta.dir, '../e2e/framework/git.ts')
    writeFileSync(
      fixture,
      `import {it,expect} from 'bun:test'
import {createBareRepo} from ${JSON.stringify(helper)}
it('no identity needed', async () => {
 const identity = Bun.spawnSync(['git','config','--get','user.name'])
 expect(identity.exitCode).not.toBe(0)
 expect(await createBareRepo(${JSON.stringify(dir())}, {'skills/deploy.md':'# Deploy skill'})).toBeTruthy()
})\n`,
    )
    const result = await runPipe(dir(), [process.execPath, resolve(import.meta.dir, 'run-tests.ts'), '--', fixture])
    expect(result.exitCode).toBe(0)
  })
  it('quotes checkout paths literally in fake scheduler scripts', async () => {
    if (process.platform === 'win32') return
    const checkout = join(dir(), "checkout $(touch QUOTE_PROBE) `touch TICK_PROBE` $HOME 'literal'")
    mkdirSync(join(checkout, 'fixtures'), {recursive: true})
    writeFileSync(join(checkout, 'test-sandbox.ts'), readFileSync(resolve(import.meta.dir, 'test-sandbox.ts')))
    writeFileSync(
      join(checkout, 'fixtures/fake-scheduler.ts'),
      readFileSync(resolve(import.meta.dir, 'fixtures/fake-scheduler.ts')),
    )
    const {createTestSandbox: create} = await import(join(checkout, 'test-sandbox.ts'))
    const sandbox: ReturnType<typeof createTestSandbox> = create('quoted-', dir())
    try {
      const result = await runPipe(sandbox.project, ['launchctl', 'not-a-real-job'])
      expect(result.exitCode).toBe(0)
      expect(existsSync(join(sandbox.project, 'QUOTE_PROBE'))).toBe(false)
      expect(existsSync(join(sandbox.project, 'TICK_PROBE'))).toBe(false)
    } finally {
      sandbox.dispose()
    }
  })
})
