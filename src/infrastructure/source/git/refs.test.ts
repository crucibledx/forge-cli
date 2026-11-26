import {existsSync, readdirSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join, relative, resolve} from 'node:path'

import {afterAll, beforeAll, expect, it} from 'bun:test'

import {SKILL_DEPLOY} from '../../../../e2e/fixtures/sources'
import {bareRepoCommit, createBareRepo, setBareRepoRef} from '../../../../e2e/framework/git'
import {createTestSandbox} from '../../../../scripts/test-sandbox'
import {verifyGitSource} from './configure'
import {absoluteRemoteUrl, gitCacheKey, load} from './load'

let fixture: ReturnType<typeof createTestSandbox> | undefined
let repo = ''
let sha = ''
const UNKNOWN_SHA = 'f'.repeat(40)
beforeAll(async () => {
  fixture = createTestSandbox('git-refs-')
  repo = await createBareRepo(fixture.project, {'skills/deploy.md': SKILL_DEPLOY})
  await setBareRepoRef(fixture.project, repo, 'refs/tags/v1.0.0', {'skills/deploy.md': SKILL_DEPLOY})
  sha = await bareRepoCommit(fixture.project, repo, 'main')
})
afterAll(() => fixture?.dispose())

it.each([
  ['a branch', () => 'main'],
  ['a tag', () => 'v1.0.0'],
  ['a full commit SHA', () => sha],
])('verification accepts %s that exists on the remote', async (_kind, ref) => {
  expect(await verifyGitSource(repo, ref())).toEqual({success: true})
})

it('verification rejects a ref that is neither a branch nor a tag on the remote', async () => {
  expect((await verifyGitSource(repo, 'missing')).success).toBe(false)
})

it('verification of a commit SHA still fails for an unreachable remote', async () => {
  expect((await verifyGitSource(join(fixture!.project, 'missing.git'), sha)).success).toBe(false)
})

it('verification rejects a full commit SHA the remote does not have, and leaves no probe repository behind', async () => {
  expect((await verifyGitSource(repo, UNKNOWN_SHA)).success).toBe(false)
  expect(readdirSync(tmpdir()).filter((name) => name.startsWith('forge-verify-'))).toEqual([])
})

it('a failed first acquisition leaves no cache behind to be taken for a warm one', async () => {
  const source = {name: 's', type: 'git' as const, url: repo, branch: UNKNOWN_SHA}
  const cacheDir = join(tmpdir(), 'forge-cache', gitCacheKey(source))
  // The SHA passes ref resolution, so the cache is created before the fetch fails.
  for (let attempt = 0; attempt < 2; attempt++) {
    await expect(load(source)).rejects.toThrow(/git fetch failed/)
    expect(existsSync(cacheDir)).toBe(false)
  }
})

it('a commit SHA source with a relative local url verifies and loads cold and warm', async () => {
  const path = relative(process.cwd(), repo)
  const url = path.startsWith('.') ? path : `./${path}`
  expect(await verifyGitSource(url, sha)).toEqual({success: true})
  for (const expectedFresh of [true, false]) {
    const {localPath, fresh} = await load({name: 's', type: 'git', url, branch: sha})
    expect(fresh).toBe(expectedFresh)
    expect(existsSync(join(localPath, 'skills/deploy.md'))).toBe(true)
  }
})

it.each([
  'https://example.com/org/repo.git',
  'ssh://git@example.com/org/repo.git',
  'file:///srv/repo.git',
  'git@example.com:org/repo.git',
  'example.com:repo.git',
])('a remote url %s is stored as given', (url) => {
  expect(absoluteRemoteUrl(url)).toBe(url)
})

it.each(['./repo.git', '../repo.git', 'repo.git'])('a relative path %s is made absolute', (url) => {
  expect(absoluteRemoteUrl(url)).toBe(resolve(url))
})

it('a branch wins over a same-named tag on the first and a later sync, as with clone --branch', async () => {
  await setBareRepoRef(fixture!.project, repo, 'refs/heads/release', {'skills/deploy.md': SKILL_DEPLOY})
  await setBareRepoRef(fixture!.project, repo, 'refs/tags/release', {'skills/review.md': '# Review skill'})
  const source = {name: 's', type: 'git' as const, url: repo, branch: 'release'}
  for (const expectedFresh of [true, false]) {
    const {localPath, fresh} = await load(source)
    expect(fresh).toBe(expectedFresh)
    expect(existsSync(join(localPath, 'skills/deploy.md'))).toBe(true)
    expect(existsSync(join(localPath, 'skills/review.md'))).toBe(false)
  }
})

it('a cold cache uses the remote object format, not the local default', async () => {
  const previous = process.env.GIT_DEFAULT_HASH
  process.env.GIT_DEFAULT_HASH = 'sha256'
  try {
    for (const branch of [sha, 'v1.0.0']) {
      for (let sync = 0; sync < 2; sync++) {
        const {localPath} = await load({name: 's', type: 'git', url: repo, branch})
        expect(existsSync(join(localPath, 'skills/deploy.md'))).toBe(true)
      }
    }
  } finally {
    if (previous === undefined) delete process.env.GIT_DEFAULT_HASH
    else process.env.GIT_DEFAULT_HASH = previous
  }
})
