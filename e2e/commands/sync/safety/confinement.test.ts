import {mkdir, readFile, symlink, writeFile} from 'node:fs/promises'
import {dirname, join} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {expect, it} from 'bun:test'

import {command, config} from './helpers'

const dir = useTmpDir('cli-root-link')
it('BR-07 whole CLI accepts a symlink-selected canonical root without touching a sibling sentinel (AC-13)', async () => {
  const root = dir(),
    source = join(root, 'upstream'),
    link = join(dirname(root), 'project-link'),
    sentinel = join(dirname(root), 'outside-sentinel')
  await mkdir(join(source, 'skills'), {recursive: true})
  await writeFile(join(source, 'skills/a.md'), '# A')
  await writeFile(sentinel, 'outside sentinel')
  await config(root, [{name: 'source', type: 'local', path: source}])
  await symlink(root, link, process.platform === 'win32' ? 'junction' : 'dir')
  expect((await command(link)).exitCode).toBe(0)
  expect(await readFile(join(root, '.claude/skills/a.md'), 'utf8')).toBe('# A')
  expect(await readFile(sentinel, 'utf8')).toBe('outside sentinel')
})

it.skipIf(process.platform === 'win32')(
  'BR-07 POSIX sync preserves legal Windows-reserved filenames (AC-13)',
  async () => {
    const root = dir(),
      source = join(root, 'upstream'),
      names = ['aux.md', 'com1.md', 'notes:draft.md']
    await mkdir(join(source, 'skills'), {recursive: true})
    for (const name of names) await writeFile(join(source, 'skills', name), `# ${name}`)
    await config(root, [{name: 'source', type: 'local', path: source}])
    for (const args of [['sync'], ['sync', '--dry-run'], ['sync']]) {
      expect((await command(root, args)).exitCode).toBe(0)
      for (const name of names) expect(await readFile(join(root, '.claude/skills', name), 'utf8')).toBe(`# ${name}`)
    }
  },
)
