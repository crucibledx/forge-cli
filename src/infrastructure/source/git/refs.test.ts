import {existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {afterAll, beforeAll, expect, it} from 'bun:test'

import {SKILL_DEPLOY} from '../../../../e2e/fixtures/sources'
import {bareRepoCommit, createBareRepo, setBareRepoRef} from '../../../../e2e/framework/git'
import {createTestSandbox} from '../../../../scripts/test-sandbox'
import {verifyGitSource} from './configure'
import {gitCacheKey, load} from './load'

let fixture: ReturnType<typeof createTestSandbox> | undefined
let repo = ''
let sha = ''
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

it('a failed first acquisition leaves no cache behind to be taken for a warm one', async () => {
  const source = {name: 's', type: 'git' as const, url: repo, branch: 'missing'}
  await expect(load(source)).rejects.toThrow(/missing/)
  expect(existsSync(join(tmpdir(), 'forge-cache', gitCacheKey(source)))).toBe(false)
})
