import {chmod, readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {expect, it} from 'bun:test'

import {prepareTransaction, transactionIO} from './transaction'
import {descriptorFlags, privateAccessMetadata, readAccessMetadata, writeAccessMetadata} from './windows-access'

const dir = useTmpDir('native-access')
it('rejects malformed self-relative DACLs before invoking native memory access', () => {
  for (const bytes of [Buffer.alloc(0), Buffer.alloc(20), Buffer.alloc(24, 255)])
    expect(() => descriptorFlags(bytes)).toThrow()
  const nullDacl = Buffer.alloc(20)
  nullDacl.writeUInt16LE(0x9004, 2)
  expect(descriptorFlags(nullDacl).offset).toBe(0)
  expect(descriptorFlags(nullDacl).flags >>> 0).toBe(0x80000004)
})
it('native Windows access preservation covers replacement, deleted-file restoration, private metadata and readonly refusal (AC-10,26)', async () => {
  if (process.platform !== 'win32') {
    expect(await readAccessMetadata(join(dir(), 'not-read-on-posix'))).toBeNull()
    expect(await privateAccessMetadata()).toBeNull()
    return
  }
  const path = join(dir(), 'restricted.md'),
    deleted = join(dir(), 'deleted.md')
  await writeFile(path, 'original')
  await writeFile(deleted, 'restore deleted')
  const privateDescriptor = (await privateAccessMetadata())!
  await writeAccessMetadata(path, privateDescriptor)
  await writeAccessMetadata(deleted, privateDescriptor)
  const before = await readAccessMetadata(path),
    deletedBefore = await readAccessMetadata(deleted)
  let failed = false
  const fs = {
    ...transactionIO,
    replace: async (...args: Parameters<typeof transactionIO.replace>) => {
      if (!failed && args[1].endsWith('config.yaml')) {
        failed = true
        throw new Error('config commit failure')
      }
      await transactionIO.replace(...args)
    },
  }
  const operations = [
    {path: 'restricted.md', content: 'replacement'},
    {path: 'deleted.md', content: null},
    {path: 'metadata/config.yaml', content: 'new private config', private: true},
  ]
  await expect((async () => (await prepareTransaction(dir(), operations, fs)).commit())()).rejects.toThrow(
    'Rollback complete',
  )
  expect(await readFile(path, 'utf8')).toBe('original')
  expect(await readFile(deleted, 'utf8')).toBe('restore deleted')
  expect(await readAccessMetadata(path)).toEqual(before)
  expect(await readAccessMetadata(deleted)).toEqual(deletedBefore)
  await (await prepareTransaction(dir(), operations)).commit()
  expect(await readAccessMetadata(path)).toEqual(before)
  const metadata = descriptorFlags((await readAccessMetadata(join(dir(), 'metadata/config.yaml')))!)
  expect(metadata.flags >>> 0).toBe(0x80000004)
  await chmod(path, 0o400)
  try {
    await expect(prepareTransaction(dir(), [{path: 'restricted.md', content: 'must refuse'}])).rejects.toThrow(
      /Read-only/,
    )
    expect(await readFile(path, 'utf8')).toBe('replacement')
  } finally {
    await chmod(path, 0o600)
  }
})
