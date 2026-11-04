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
