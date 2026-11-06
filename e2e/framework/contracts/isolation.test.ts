import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {describe, expect, it} from 'bun:test'

import {createTestSandbox} from '../../../scripts/test-sandbox'
import {runPipe} from '../pipe'

describe('BR-10 full-suite process isolation (AC-19)', () => {
  const dir = useTmpDir('isolation')
  it('uses distinct mkdtemp project/home/temp roots with an allowlist and fake schedulers', async () => {
    const a = createTestSandbox('isolation-a-')
    const b = createTestSandbox('isolation-b-')
    try {
      expect(a.root).not.toBe(b.root)
      expect(new Set([a.project, a.env.HOME, a.env.TMPDIR]).size).toBe(3)
      const fixture = join(import.meta.dir, 'fixtures/process.ts')
      const result = await runPipe(a.project, [process.execPath, fixture, 'env'])
      const probe = JSON.parse(result.stdout.replaceAll('<project>', a.project))
      expect(probe.home).toBe(a.env.HOME)
      expect(probe.temp).toBe(a.env.TMPDIR)
      for (const key of ['SSH_AUTH_SOCK', 'GITHUB_TOKEN', 'NPM_TOKEN', 'AWS_SECRET_ACCESS_KEY', 'FORGE_SECRET']) {
        expect(probe.env[key]).toBeUndefined()
      }
      expect(probe.env.GIT_TERMINAL_PROMPT).toBe('0')
      expect(probe.env.GIT_ALLOW_PROTOCOL).toBe('file')
      expect(probe.env.GIT_CONFIG_GLOBAL).toBe(join(a.root, 'gitconfig'))
      const fake = await runPipe(a.project, [process.platform === 'win32' ? 'schtasks' : 'launchctl', 'not-a-real-job'])
      expect(fake.exitCode).toBe(0)
    } finally {
      a.dispose()
      b.dispose()
    }
  })
  it('launcher isolates before cached Git imports, preserving inherited sentinels and environment', async () => {
    const before = {...process.env}
    const outsideCache = join(tmpdir(), 'forge-cache')
    mkdirSync(outsideCache, {recursive: true})
    const sentinel = join(outsideCache, `outside-${crypto.randomUUID()}`)
    writeFileSync(sentinel, 'outside cache must survive')
    const probe = join(dir(), 'probe.test.ts')
    const output = join(dir(), 'probe.json')
    const loader = resolve(import.meta.dir, '../../../src/infrastructure/source/git/load.ts')
    writeFileSync(
      probe,
      `
import {it, expect} from 'bun:test'
import {writeFileSync} from 'node:fs'
import {tmpdir, homedir} from 'node:os'
import {cleanupAllCaches} from ${JSON.stringify(loader)}
it('isolation probe', async () => {
 expect(process.env.FORGE_SECRET).toBeUndefined()
 expect(process.env.SSH_AUTH_SOCK).toBeUndefined()
 expect(process.env.GIT_CONFIG_COUNT).toBeUndefined()
 expect(tmpdir()).not.toBe(${JSON.stringify(tmpdir())})
 await cleanupAllCaches()
 writeFileSync(${JSON.stringify(output)}, JSON.stringify({home:homedir(), temp:tmpdir()}))
})
`,
    )
    const launcher = resolve(import.meta.dir, '../../../scripts/run-tests.ts')
    const homes = []
    for (let i = 0; i < 2; i++) {
      const result = await runPipe(dir(), [process.execPath, launcher, '--', probe], {
        env: {FORGE_SECRET: 'fixture-credential', SSH_AUTH_SOCK: 'fixture-agent', GIT_CONFIG_COUNT: '0'},
      })
      expect(result.exitCode).toBe(0)
      expect(result.stderr + result.stdout).not.toContain('fixture-credential')
      homes.push(JSON.parse(readFileSync(output, 'utf8')))
      expect(existsSync(sentinel)).toBe(true)
      expect(readFileSync(sentinel, 'utf8')).toBe('outside cache must survive')
    }
    expect(homes[0].home).not.toBe(homes[1].home)
    expect(homes[0].temp).not.toBe(homes[1].temp)
    expect(dirname(homes[0].home)).toBe(dirname(homes[0].temp))
    expect(process.env).toEqual(before)
  })
})
