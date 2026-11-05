import {chmod, mkdir, readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {expect, it} from 'bun:test'

import {prepareTransaction, TransactionError, transactionIO} from './transaction'
import {
  accessMetadataFromSddl,
  descriptorFlags,
  openPrivateTemporary,
  privateAccessMetadata,
  readAccessMetadata,
  writeAccessMetadata,
} from './windows-access'

const dir = useTmpDir('native-access')
async function broadParent() {
  const root = join(dir(), 'broad')
  await mkdir(root)
  await writeAccessMetadata(root, (await accessMetadataFromSddl('D:P(A;OICI;FA;;;WD)'))!)
  return root
}
async function expectPrivate(path: string) {
  const actual = descriptorFlags((await readAccessMetadata(path))!)
  const expected = descriptorFlags((await privateAccessMetadata())!)
  const acl = (value: ReturnType<typeof descriptorFlags>) =>
    value.bytes.subarray(value.offset, value.offset + value.bytes.readUInt16LE(value.offset + 2))
  expect(actual.offset).toBeGreaterThan(0)
  expect(actual.flags >>> 0).toBe(0x80000004)
  expect(acl(actual)).toEqual(acl(expected))
}
it('C5 native Windows private creation precedes the first byte under an Everyone-inheritable parent (AC-10,26)', async () => {
  if (process.platform !== 'win32') {
    await expect(openPrivateTemporary(join(dir(), 'unsupported'))).rejects.toThrow('unavailable')
    return
  }
  const root = await broadParent(),
    path = join(root, '.forge-private.tmp')
  const file = await transactionIO.openTemp(path)
  try {
    await expectPrivate(path)
    expect((await readFile(path)).length).toBe(0)
    const bytes = Buffer.alloc(2 * 1024 * 1024 + 17, 42)
    await file.writeFile(bytes)
    expect(await readFile(path)).toEqual(bytes)
    await expect(transactionIO.openTemp(path)).rejects.toThrow('exclusive')
    expect(await readFile(path)).toEqual(bytes)
    await expectPrivate(path)
  } finally {
    await file.close()
  }
  await file.close()
  await expect(file.writeFile(Buffer.from('closed'))).rejects.toThrow('closed')
})
it('C5 default transaction writer keeps partial failed recovery bytes private before metadata application (AC-10,26)', async () => {
  if (process.platform !== 'win32') return
  const root = await broadParent(),
    path = join(root, 'restricted.md'),
    config = join(root, 'config.yaml')
  const original = Buffer.from('original protected bytes')
  for (const [name, bytes] of [
    [path, original],
    [config, Buffer.from('old config')],
  ] as const) {
    await writeFile(name, bytes)
    await writeAccessMetadata(name, (await privateAccessMetadata())!)
  }
  let restoring = false,
    observed = 0,
    recoveryPath = ''
  const fs = {
    ...transactionIO,
    openTemp: async (name: string) => {
      const file = await transactionIO.openTemp(name)
      try {
        await expectPrivate(name)
        expect((await readFile(name)).length).toBe(0)
        observed++
      } catch (error) {
        await file.close()
        throw error
      }
      return {
        async writeFile(bytes: Uint8Array) {
          await expectPrivate(name)
          const first = Math.max(1, Math.floor(bytes.length / 2))
          await file.writeFile(bytes.subarray(0, first))
          if (restoring && Buffer.from(bytes).equals(original)) {
            recoveryPath = name
            throw new Error('partial recovery write failed')
          }
          await file.writeFile(bytes.subarray(first))
        },
        close: () => file.close(),
      }
    },
    replace: async (...args: Parameters<typeof transactionIO.replace>) => {
      if (!restoring && args[1].endsWith('config.yaml')) {
        restoring = true
        throw new Error('config replacement failed')
      }
      await transactionIO.replace(...args)
    },
  }
  let failure: unknown
  try {
    await (
      await prepareTransaction(
        root,
        [
          {path: 'restricted.md', content: 'replacement'},
          {path: 'config.yaml', content: 'new config', private: true},
        ],
        fs,
      )
    ).commit()
  } catch (error) {
    failure = error
  }
  expect(failure).toBeInstanceOf(TransactionError)
  expect((failure as TransactionError).unrestored).toEqual(['restricted.md'])
  expect(observed).toBeGreaterThanOrEqual(4)
  expect(recoveryPath).not.toBe('')
  expect((failure as TransactionError).recoveryFiles).toContain(recoveryPath.replaceAll('\\', '/').split('/').at(-1)!)
  await expectPrivate(recoveryPath)
  expect(await readFile(recoveryPath)).toEqual(original.subarray(0, Math.floor(original.length / 2)))
  expect(await readFile(config, 'utf8')).toBe('old config')
})
it('private-temporary support failure blocks before protected mutation (C5, AC-10)', async () => {
  const path = join(dir(), 'untouched.md')
  await writeFile(path, 'before')
  await expect(
    prepareTransaction(dir(), [{path: 'untouched.md', content: 'after'}], {
      ...transactionIO,
      checkPrivateTemporarySupport: async () => {
        throw new Error('private creation unsupported')
      },
    }),
  ).rejects.toThrow('private creation unsupported')
  expect(await readFile(path, 'utf8')).toBe('before')
})
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
