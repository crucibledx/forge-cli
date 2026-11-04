import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import {join, resolve} from 'node:path'

import {describe, expect, it} from 'bun:test'

import {runPipe} from '../e2e/framework/pipe'
import {useTmpDir} from '../src/test-helpers/tmp'
import type {createTestSandbox} from './test-sandbox'

describe('isolated launcher regressions (BR-09,10)', () => {
  const dir = useTmpDir('launcher-contracts')
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
