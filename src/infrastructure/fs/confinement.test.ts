import {mkdir, readFile, rename, symlink, writeFile} from 'node:fs/promises'
import {dirname, join} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {describe, expect, it} from 'bun:test'

import {createConfinement} from './confinement'
import {readFileContent} from './reader'
import {prepareTransaction, transactionIO} from './transaction'

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
  it.each(['.crucible/sync-state.json', '.crucible/forge.config.yaml', 'target.md.bak'])(
    'rejects metadata/backup symlink %s before any mutation (AC-12)',
    async (path) => {
      const outside = join(dirname(dir()), 'outside')
      await mkdir(outside)
      const sentinel = join(outside, 'sentinel')
      await writeFile(sentinel, 'outside sentinel')
      await mkdir(join(dir(), '.crucible'))
      await symlink(sentinel, join(dir(), path), process.platform === 'win32' ? 'file' : undefined)
      await expect(
        prepareTransaction(dir(), [
          {path: 'earlier.md', content: 'must not commit'},
          {path, content: 'forbidden', private: path.startsWith('.crucible'), backup: path.endsWith('.bak')},
        ]),
      ).rejects.toThrow()
      expect(await readFile(sentinel, 'utf8')).toBe('outside sentinel')
      await expect(readFile(join(dir(), 'earlier.md'))).rejects.toThrow()
    },
  )
  it('revalidates metadata and target ancestors during compensation, reports unrestored paths without following links (AC-12)', async () => {
    const outside = join(dirname(dir()), 'outside')
    await mkdir(outside)
    await mkdir(join(dir(), '.crucible'))
    await writeFile(join(outside, 'sync-state.json'), 'external state sentinel')
    await writeFile(join(outside, 'forge.config.yaml'), 'external config sentinel')
    await writeFile(join(dir(), '.crucible/sync-state.json'), 'old state')
    await writeFile(join(dir(), '.crucible/forge.config.yaml'), 'old config')
    const fs = {
      ...transactionIO,
      replace: async (...args: Parameters<typeof transactionIO.replace>) => {
        if (args[1].endsWith('forge.config.yaml')) {
          await rename(join(dir(), '.crucible'), join(dir(), 'saved-metadata'))
          await symlink(outside, join(dir(), '.crucible'), process.platform === 'win32' ? 'junction' : 'dir')
          throw new Error('injected commit failure with changed ancestor')
        }
        await transactionIO.replace(...args)
      },
    }
    const prepared = await prepareTransaction(
      dir(),
      [
        {path: '.crucible/sync-state.json', content: 'new state', private: true},
        {path: '.crucible/forge.config.yaml', content: 'new config', private: true},
      ],
      fs,
    )
    await expect(prepared.commit()).rejects.toThrow('Recovery incomplete; unrestored/untrusted:')
    expect(await readFile(join(outside, 'sync-state.json'), 'utf8')).toBe('external state sentinel')
    expect(await readFile(join(outside, 'forge.config.yaml'), 'utf8')).toBe('external config sentinel')
  })
})
