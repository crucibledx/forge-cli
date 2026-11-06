import {join} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {expect, it} from 'bun:test'

import {SKILL_DEPLOY} from '../../../../e2e/fixtures/sources'
import {createBareRepo} from '../../../../e2e/framework/git'
import {loadSourceFiles} from '../index'
import {withGitCache} from './load'

const dir = useTmpDir('shared-git-cache')
it('AC-2 same-cache cold and warm acquisitions retain both subdirectory outcomes', async () => {
  const url = await createBareRepo(dir(), {'skills/deploy.md': SKILL_DEPLOY})
  const source = {name: 'root', type: 'git' as const, url, branch: 'fixture-skills'}
  for (let round = 0; round < 2; round++) {
    const [root, nested] = await Promise.all([
      loadSourceFiles(source),
      loadSourceFiles({...source, name: 'nested', path: 'skills'}),
    ])
    expect(root.find((file) => file.relativePath === 'skills/deploy.md')?.content).toBe(SKILL_DEPLOY)
    expect(nested.find((file) => file.relativePath === 'deploy.md')?.content).toBe(SKILL_DEPLOY)
  }
})
it('AC-2 a failed shared acquisition does not suppress its queued sibling or independent caches', async () => {
  const source = {name: 'test', type: 'git' as const, url: join(dir(), 'repository'), branch: 'main'}
  let release!: () => void
  const blocked = new Promise<void>((resolve) => {
    release = resolve
  })
  const first = withGitCache(source, async () => {
    await blocked
    throw new Error('first failed')
  })
  const second = withGitCache(source, async () => 'queued success')
  const independent = await withGitCache({...source, branch: 'other'}, async () => 'independent success')
  expect(independent).toBe('independent success')
  release()
  const outcomes = await Promise.allSettled([first, second])
  expect(outcomes[0].status).toBe('rejected')
  expect(outcomes[1]).toEqual({status: 'fulfilled', value: 'queued success'})
})
