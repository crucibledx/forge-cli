import {mkdir} from 'node:fs/promises'
import {tmpdir} from 'node:os'
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
    stdout: 'abc123\trefs/heads/main\n',
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
  const PINNED_SHA = 'a'.repeat(40)

  afterEach(() => cleanupCache(SAFE_URL, PINNED_SHA))

  function call(spy: ReturnType<typeof stubGit>, command: string): string[] {
    const found = gitArgs(spy).find((args) => args[0] === command)
    if (!found) throw new Error(`git ${command} was not run`)
    return found
  }

  it('ls-remote', async () => {
    spawnSpy = stubGit()
    await verifyGitSource(SAFE_URL, 'main')
    expect(gitArgs(spawnSpy)).toEqual([['ls-remote', '--', SAFE_URL, 'refs/heads/main', 'refs/tags/main']])
  })

  it('clone', async () => {
    spawnSpy = stubGit()
    await gitLoader.load({name: 's', type: 'git', url: SAFE_URL, branch: 'main'})
    const clone = call(spawnSpy, 'clone')
    expect(clone.slice(clone.indexOf('--'))).toEqual(['--', SAFE_URL, expect.stringContaining('forge-cache')])
  })

  it('remote add and fetch for a commit SHA source', async () => {
    spawnSpy = stubGit()
    await gitLoader.load({name: 's', type: 'git', url: SAFE_URL, branch: PINNED_SHA})
    expect(call(spawnSpy, 'remote')).toEqual(['remote', 'add', '--', 'origin', SAFE_URL])
    expect(call(spawnSpy, 'fetch')).toEqual([
      'fetch',
      '--depth',
      '1',
      '--',
      'origin',
      `+${PINNED_SHA}:refs/forge/fetched`,
    ])
  })

  it('fetch on the warm cache', async () => {
    const source = {name: 's', type: 'git' as const, url: SAFE_URL, branch: 'main'}
    await mkdir(join(tmpdir(), 'forge-cache', gitCacheKey(source), '.git'), {recursive: true})
    spawnSpy = stubGit()
    await gitLoader.load(source)
    expect(call(spawnSpy, 'fetch')).toEqual([
      'fetch',
      '--depth',
      '1',
      '--',
      'origin',
      '+refs/heads/main:refs/forge/fetched',
    ])
  })
})
