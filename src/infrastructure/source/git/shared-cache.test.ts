import {existsSync} from 'node:fs'
import {cp, readFile, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {afterAll, beforeAll, expect, it} from 'bun:test'

import {SKILL_DEPLOY} from '../../../../e2e/fixtures/sources'
import {createBareRepo} from '../../../../e2e/framework/git'
import {createTestSandbox} from '../../../../scripts/test-sandbox'
import {loadSourceFiles} from '../index'
import {gitCacheKey, withGitCache} from './load'

const dir = useTmpDir('shared-git-cache')
let fixture: ReturnType<typeof createTestSandbox> | undefined
let template = ''
beforeAll(async () => {
  fixture = createTestSandbox('shared-git-history-')
  template = await createBareRepo(fixture.project, {'skills/deploy.md': SKILL_DEPLOY})
})
afterAll(() => fixture?.dispose())
// Import immutable history once; each mutable copy still has a unique URL/cache.
async function repository(path = join(dir(), 'repo.git')) {
  await cp(template, path, {recursive: true, force: false, errorOnExist: true})
  return path
}
it('AC-19 shared fixture history gives each acquisition an independent mutable repository', async () => {
  const first = await repository(),
    second = await repository(join(dir(), 'other.git'))
  const before = await readFile(join(template, 'HEAD'), 'utf8')
  await writeFile(join(first, 'HEAD'), 'ref: refs/heads/mutated\n')
  expect(await readFile(join(template, 'HEAD'), 'utf8')).toBe(before)
  expect(await readFile(join(second, 'HEAD'), 'utf8')).toBe(before)
  expect(gitCacheKey({name: 'a', type: 'git', url: first, branch: 'main'})).not.toBe(
    gitCacheKey({name: 'b', type: 'git', url: second, branch: 'main'}),
  )
})
it.each(['.', './', './.', '././', './/', '.\\', '.\\.\\'])(
  'AC-2 equivalent Git root selector %s works on cold and warm acquisition',
  async (path) => {
    const url = await repository()
    const source = {name: 'root', type: 'git' as const, url, branch: 'main', path}
    const cache = join(tmpdir(), 'forge-cache', gitCacheKey(source))
    expect(existsSync(cache)).toBe(false)
    for (let round = 0; round < 2; round++) {
      const files = await loadSourceFiles(source)
      expect(files.find((file) => file.relativePath === 'skills/deploy.md')?.content).toBe(SKILL_DEPLOY)
      expect(existsSync(join(cache, '.git'))).toBe(true)
    }
  },
)
it.each(['..', 'skills/..', 'skills/../.', '../repo', 'skills\\..', '/'])(
  'AC-2,12 Git root selector handling does not bypass confinement for %s',
  async (path) => {
    const url = await repository()
    await expect(loadSourceFiles({name: 'root', type: 'git', url, branch: 'main', path})).rejects.toThrow(/Unsafe path/)
  },
)
it('AC-2 same-cache cold and warm acquisitions retain both subdirectory outcomes', async () => {
  const url = await repository()
  const source = {name: 'root', type: 'git' as const, url, branch: 'fixture-skills'}
  const cache = join(tmpdir(), 'forge-cache', gitCacheKey(source))
  expect(existsSync(cache)).toBe(false)
  for (let round = 0; round < 2; round++) {
    const [root, nested] = await Promise.all([
      loadSourceFiles(source),
      loadSourceFiles({...source, name: 'nested', path: 'skills'}),
    ])
    expect(root.find((file) => file.relativePath === 'skills/deploy.md')?.content).toBe(SKILL_DEPLOY)
    expect(nested.find((file) => file.relativePath === 'deploy.md')?.content).toBe(SKILL_DEPLOY)
    expect(existsSync(join(cache, '.git'))).toBe(true)
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
