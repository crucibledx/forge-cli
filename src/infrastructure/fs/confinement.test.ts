import {mkdir, readFile, symlink, writeFile} from 'node:fs/promises'
import {dirname, join} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {describe, expect, it} from 'bun:test'

import {createConfinement} from './confinement'
import {readFileContent} from './reader'
import {prepareTransaction} from './transaction'

describe('BR-07 confinement (AC-12)', () => {
  const dir = useTmpDir('confinement')
  it('accepts nested paths, mixed separators, absolute in-root paths and a symlink-selected root', async () => {
    const link = join(dirname(dir()), 'root-link')
    await symlink(dir(), link, process.platform === 'win32' ? 'junction' : 'dir')
    const boundary = await createConfinement(link)
    expect(await boundary.resolve('nested\\file.md')).toBe(join(boundary.root, 'nested/file.md'))
    expect(await boundary.resolve(join(link, 'a'))).toBe(join(boundary.root, 'a'))
    await (await prepareTransaction(link, [{path: 'nested/a.md', content: 'safe'}])).commit()
    expect(await readFile(join(dir(), 'nested/a.md'), 'utf8')).toBe('safe')
  })
  it.each([
    '',
    '.',
    '..',
    '../escape',
    'a/../../escape',
    '..\\escape',
    'C:relative',
    'D:\\foreign\\file',
    '\\\\server\\share\\file',
    'stream:secret',
    'a.',
    'CON',
  ])('refuses unsafe path %j', async (path) => {
    const boundary = await createConfinement(dir())
    await expect(boundary.resolve(path)).rejects.toThrow()
  })
  it('refuses absolute outside-root and sibling-prefix paths', async () => {
    const boundary = await createConfinement(dir())
    for (const path of [dirname(dir()), `${dir()}-sibling/file`]) await expect(boundary.resolve(path)).rejects.toThrow()
  })
  it.each(['leaf', 'ancestor', 'dangling', 'internal'])(
    'rejects pre-existing %s symlinks before read/write/delete',
    async (kind) => {
      const outside = join(dirname(dir()), 'outside')
      await mkdir(outside)
      const sentinel = join(outside, 'sentinel')
      await writeFile(sentinel, 'external sentinel')
      if (kind === 'internal') await writeFile(join(dir(), 'internal'), 'internal content')
      const path = kind === 'ancestor' ? 'link/sentinel' : 'link'
      const destination =
        kind === 'ancestor'
          ? outside
          : kind === 'dangling'
            ? join(outside, 'missing')
            : kind === 'internal'
              ? join(dir(), 'internal')
              : sentinel
      await symlink(
        destination,
        join(dir(), 'link'),
        process.platform === 'win32' ? (kind === 'ancestor' ? 'junction' : 'file') : undefined,
      )
      await expect(readFileContent(dir(), path)).rejects.toThrow()
      for (const content of ['replace', null])
        await expect(prepareTransaction(dir(), [{path, content}])).rejects.toThrow()
      expect(await readFile(sentinel, 'utf8')).toBe('external sentinel')
    },
  )
})
