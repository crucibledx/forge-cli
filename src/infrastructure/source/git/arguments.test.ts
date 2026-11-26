import {mkdir} from 'node:fs/promises'
import {join} from 'node:path'

import {afterEach, describe, expect, it, spyOn} from 'bun:test'

import {projectConfigSchema} from '@infrastructure/config/schema'

import {verifyGitSource} from './configure'
import {gitLoader} from './index'
import {cleanupCache, gitCacheKey, GitError} from './load'
import {GIT_SOURCE_MESSAGES} from './messages'

const SAFE_URL = 'git@github.com:org/arguments.git'

function stubGit() {
  return spyOn(Bun, 'spawn').mockImplementation((() => ({
    exited: Promise.resolve(0),
    stdout: '',
    stderr: '',
    kill: () => {},
  })) as never)
}

function gitArgs(spy: ReturnType<typeof stubGit>): string[][] {
  return spy.mock.calls.map((call) => (call[0] as string[]).slice(1))
}

let spawnSpy: ReturnType<typeof stubGit> | undefined
afterEach(async () => {
  spawnSpy?.mockRestore()
  spawnSpy = undefined
  await cleanupCache(SAFE_URL, 'main')
})

describe.each([
  ['url', {url: '--quiet', branch: 'main'}],
  ['branch', {url: SAFE_URL, branch: '--quiet'}],
] as const)('a git source %s that starts with "-"', (field, values) => {
  const message = GIT_SOURCE_MESSAGES.optionLike(field)

  it('is rejected when the config is parsed', () => {
    expect(() =>
      projectConfigSchema.parse({version: '1', assistants: [], sources: [{name: 's', type: 'git', ...values}]}),
    ).toThrow(message)
  })

  it('is rejected by load before any git process starts', async () => {
    spawnSpy = stubGit()
    const load = gitLoader.load({name: 's', type: 'git', ...values})
    await expect(load).rejects.toBeInstanceOf(GitError)
    await expect(load).rejects.toThrow(message)
    expect(spawnSpy).not.toHaveBeenCalled()
  })

  it('is rejected by verification before any git process starts', async () => {
    spawnSpy = stubGit()
    expect(await verifyGitSource(values.url, values.branch)).toEqual({success: false, error: message})
    expect(spawnSpy).not.toHaveBeenCalled()
  })
})

describe('git calls end option parsing before positional arguments', () => {
  it('clone', async () => {
    spawnSpy = stubGit()
    await gitLoader.load({name: 's', type: 'git', url: SAFE_URL, branch: 'main'})
    const [clone] = gitArgs(spawnSpy)
    expect(clone.slice(clone.indexOf('--'))).toEqual(['--', SAFE_URL, expect.stringContaining('forge-cache')])
  })

  it('fetch on the warm cache', async () => {
    const source = {name: 's', type: 'git' as const, url: SAFE_URL, branch: 'main'}
    const {tmpdir} = await import('node:os')
    await mkdir(join(tmpdir(), 'forge-cache', gitCacheKey(source), '.git'), {recursive: true})
    spawnSpy = stubGit()
    await gitLoader.load(source)
    const [fetch] = gitArgs(spawnSpy)
    expect(fetch).toEqual(['fetch', '--', 'origin', '+main:refs/forge/fetched'])
  })

  it('ls-remote', async () => {
    spawnSpy = stubGit()
    await verifyGitSource(SAFE_URL, 'main')
    expect(gitArgs(spawnSpy)).toEqual([['ls-remote', '--exit-code', '--', SAFE_URL, 'refs/heads/main']])
  })
})
