import {spawnSync} from 'node:child_process'
import {mkdir, readFile, realpath, rename, symlink, writeFile} from 'node:fs/promises'
import {dirname, join} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {describe, expect, it} from 'bun:test'

import {createConfinement} from './confinement'
import {createFileReader, readDiskContents} from './reader'
import {prepareTransaction, transactionIO} from './transaction'

describe('BR-07 confinement (AC-12)', () => {
  const dir = useTmpDir('confinement')
  it.skipIf(process.platform === 'win32')(
    'canonicalizes literal-backslash roots without redirecting into a separator alias',
    async () => {
      const base = dir(),
        root = join(base, 'selected\\root'),
        link = join(base, 'root-link'),
        alias = join(base, 'selected/root')
      await mkdir(root)
      await mkdir(alias, {recursive: true})
      await writeFile(join(alias, 'sentinel'), 'outside')
      await symlink(root, link)
      const expected = join(await realpath(base), 'selected\\root')
      for (const selected of [root, link]) {
        const boundary = await createConfinement(selected)
        expect(boundary.root).toBe(expected)
        expect(await boundary.resolve(join(selected, 'a.md'))).toBe(join(expected, 'a.md'))
        expect(await boundary.resolve('nested\\a.md')).toBe(join(expected, 'nested/a.md'))
        for (const path of ['..\\selected/root/sentinel', join(alias, 'sentinel'), selected])
          await expect(boundary.resolve(path)).rejects.toThrow()
        await (await prepareTransaction(selected, [{path: 'a.md', content: 'safe'}])).commit()
        expect(await readFile(join(root, 'a.md'), 'utf8')).toBe('safe')
        expect(await readFile(join(alias, 'sentinel'), 'utf8')).toBe('outside')
      }
    },
  )
  it.skipIf(process.platform === 'win32')(
    'keeps a natively created literal-backslash root apart from its separator alias through apply and disk reads',
    async () => {
      const base = await realpath(dir()),
        root = join(base, 'team\\notes'),
        alias = join(base, 'team/notes')
      // Bun's realpath maps this root onto the alias, so both must exist natively.
      const created = spawnSync('/bin/sh', [
        '-c',
        'mkdir -p "$1" "$2" && printf literal > "$1/kept.md" && printf literal > "$1/gone.md" && printf alias > "$2/kept.md" && printf alias > "$2/gone.md"',
        'native-fixture',
        root,
        alias,
      ])
      expect(created.status).toBe(0)
      const boundary = await createConfinement(root)
      expect(boundary.root).toBe(root)
      const target = await boundary.resolve('.claude/rules/a.md')
      expect(target).toBe(join(root, '.claude/rules/a.md'))
      expect(await boundary.resolve(target)).toBe(target)
      const operations = [
        {path: '.claude/rules/a.md', content: 'new'},
        {path: 'kept.md', content: 'updated'},
        {path: 'gone.md', content: null},
      ]
      await prepareTransaction(root, operations)
      expect(await readFile(join(root, 'kept.md'), 'utf8')).toBe('literal')
      await (await prepareTransaction(root, operations)).commit()
      const entry = {hash: 'a'.repeat(64), sourceName: 'fixture', baseline: 'installed' as const}
      const contents = await readDiskContents(root, {
        version: 2,
        lastSync: '2026-11-11T00:00:00.000Z',
        files: {'.claude/rules/a.md': entry, 'kept.md': entry, 'gone.md': entry},
      })
      expect(contents).toEqual({
        '.claude/rules/a.md': Buffer.from('new'),
        'kept.md': Buffer.from('updated'),
        'gone.md': null,
      })
      expect(await readFile(join(alias, 'kept.md'), 'utf8')).toBe('alias')
      expect(await readFile(join(alias, 'gone.md'), 'utf8')).toBe('alias')
      await expect(readFile(join(alias, '.claude/rules/a.md'))).rejects.toThrow()
    },
  )
  it.skipIf(process.platform === 'win32')(
    'bounds selected-root symlink cycles containing literal backslashes',
    async () => {
      await symlink('loop\\root', join(dir(), 'loop\\root'))
      await expect(createConfinement(join(dir(), 'loop\\root'))).rejects.toThrow('too many symbolic links')
    },
  )
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
  ])('refuses unsafe path %j', async (path) => {
    const boundary = await createConfinement(dir())
    await expect(boundary.resolve(path)).rejects.toThrow()
  })
  it.each([
    'stream:secret',
    'notes:draft.md',
    'a.',
    'a ',
    'CON',
    'aux.md',
    'com1.md',
    'nested/PRN.txt',
    'nested/file:stream',
    'nested/folder./file.md',
  ])('uses native filename restrictions for %j (AC-12)', async (path) => {
    const boundary = await createConfinement(dir())
    if (process.platform === 'win32') {
      await expect(boundary.resolve(path)).rejects.toThrow('non-portable filename or alternate data stream')
      await expect(prepareTransaction(dir(), [{path, content: 'safe'}])).rejects.toThrow()
      return
    }
    expect(await boundary.resolve(path)).toBe(join(boundary.root, path))
    await (await prepareTransaction(dir(), [{path, content: 'safe'}])).commit()
    const contents = await readDiskContents(dir(), {
      version: 2,
      lastSync: '2026-11-08T00:00:00.000Z',
      files: {[path]: {hash: 'a'.repeat(64), sourceName: 'fixture', baseline: 'installed'}},
    })
    expect(contents[path]).toEqual(Buffer.from('safe'))
  })
  it('refuses absolute outside-root and sibling-prefix paths', async () => {
    const boundary = await createConfinement(dir())
    for (const path of [dirname(dir()), `${dir()}-sibling/file`]) await expect(boundary.resolve(path)).rejects.toThrow()
  })
  it('rejects absolute parent traversal before native resolution collapses it', async () => {
    const boundary = await createConfinement(dir())
    for (const path of [`${dir()}/nested/../file.md`, `${dir()}\\nested\\..\\file.md`])
      await expect(boundary.resolve(path)).rejects.toThrow()
  })
  it.skipIf(process.platform === 'win32')('refuses a non-directory in a literal-root symlink target', async () => {
    await writeFile(join(dir(), 'file'), 'not a directory')
    await symlink('file/../target', join(dir(), 'root\\link'))
    await mkdir(join(dir(), 'target'))
    await expect(createConfinement(join(dir(), 'root\\link'))).rejects.toThrow('root ancestor is not a directory')
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
      const read = await createFileReader(dir())
      await expect(read(path)).rejects.toThrow()
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
