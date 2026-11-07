import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {syncFixture, trackedPath} from '@test-helpers/sync-fixture'
import {protectedBytes} from '@test-helpers/sync-fixture'
import {useTmpDir} from '@test-helpers/tmp'
import {expect, it} from 'bun:test'
import {parse, stringify} from 'yaml'

import {command, config} from './helpers'

const dir = useTmpDir('repeat-contract')
if (process.platform !== 'win32')
  it.each(['skills/a\\b.md', '.claude/skills/a\\b.md'])(
    'AC-9,14 literal POSIX backslash input cannot succeed once and fail next: %s',
    async (path) => {
      const root = dir()
      await mkdir(join(root, 'upstream', path, '..'), {recursive: true})
      await writeFile(join(root, 'upstream', path), 'desired')
      await config(root, [{name: 'literal-backslash', type: 'local', path: 'upstream'}])
      const before = await protectedBytes(root)
      for (let run = 0; run < 2; run++) {
        const result = await command(root)
        expect(result.exitCode).toBe(1)
        expect(result.stdout + result.stderr).toContain('Backslash')
        expect(await protectedBytes(root)).toEqual(before)
      }
    },
  )
async function installed() {
  const root = dir()
  await syncFixture(root)
  await mkdir(join(root, 'upstream/rules'), {recursive: true})
  await writeFile(join(root, 'upstream/rules/a.md'), 'after')
  expect((await command(root)).exitCode).toBe(0)
  return root
}
it('AC-14 repeated real CLI no-ops retain exact installed and backup bytes', async () => {
  const root = await installed()
  const target = await readFile(join(root, trackedPath)),
    backup = await readFile(join(root, `${trackedPath}.bak`))
  for (let run = 0; run < 3; run++) {
    expect((await command(root)).exitCode).toBe(0)
    expect(await readFile(join(root, trackedPath))).toEqual(target)
    expect(await readFile(join(root, `${trackedPath}.bak`))).toEqual(backup)
  }
})
it.each(['local-wins', 'remote-wins', 'error'] as const)(
  'AC-14 repeated changed conflicts retain the configured %s policy and never overwrite an older backup',
  async (policy) => {
    const root = await installed()
    const configPath = join(root, '.crucible/forge.config.yaml')
    const config = parse(await readFile(configPath, 'utf8'))
    config.sync.local_conflict_strategy = policy
    await writeFile(configPath, stringify(config))
    await writeFile(join(root, trackedPath), 'local edit')
    await writeFile(join(root, 'upstream/rules/a.md'), 'new incoming')
    const before = await protectedBytes(root)
    for (let run = 0; run < 2; run++) {
      const result = await command(root)
      expect(result.exitCode).toBe(policy === 'local-wins' ? 0 : 1)
      expect(await readFile(join(root, trackedPath), 'utf8')).toBe('local edit')
      expect(await readFile(join(root, `${trackedPath}.bak`), 'utf8')).toBe('before')
      expect(parse(await readFile(configPath, 'utf8')).sync.local_conflict_strategy).toBe(policy)
      if (policy !== 'local-wins') expect(await protectedBytes(root)).toEqual(before)
    }
  },
)
