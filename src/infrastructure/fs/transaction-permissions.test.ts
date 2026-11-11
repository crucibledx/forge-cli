import {constants} from 'node:fs'
import {access, chmod, mkdir, readdir, readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {accessMetadataFromSddl} from '@test-helpers/windows-access'
import {expect, it} from 'bun:test'

import {prepareTransaction, TransactionError, transactionIO} from './transaction'
import {readAccessMetadata, writeAccessMetadata} from './windows-access'

const dir = useTmpDir('transaction-permissions')
it.each(['replace', 'delete', 'create', 'missing-parent'])(
  'AC-8/10 Windows directory ACL refuses before staging: %s',
  async (kind) => {
    if (process.platform !== 'win32') return
    const parent = join(dir(), 'locked')
    await mkdir(parent)
    const file = join(parent, 'a.md')
    await writeFile(file, 'before')
    const original = await readAccessMetadata(parent),
      originalFile = await readAccessMetadata(file)
    const denied = await accessMetadataFromSddl('D:P(D;;0x00000006;;;WD)(A;;FA;;;OW)(A;;FA;;;SY)')
    try {
      // Parent DACL updates propagate inherited ACEs. Keep this file explicitly readable.
      await writeAccessMetadata(file, await accessMetadataFromSddl('D:P(A;;FA;;;OW)(A;;FA;;;SY)'))
      const fileAcl = await readAccessMetadata(file)
      expect(await readFile(file, 'utf8')).toBe('before')
      await writeAccessMetadata(parent, denied)
      const before = await readdir(parent),
        acl = await readAccessMetadata(parent)
      expect(await readFile(file, 'utf8')).toBe('before')
      expect(await readAccessMetadata(file)).toEqual(fileAcl)
      await expect(
        prepareTransaction(dir(), [
          {
            path: kind === 'missing-parent' ? 'locked/new/a.md' : kind === 'create' ? 'locked/new.md' : 'locked/a.md',
            content: kind === 'delete' ? null : 'after',
          },
        ]),
      ).rejects.toThrow('Directory creation access denied')
      expect(await readdir(parent)).toEqual(before)
      expect(await readFile(file, 'utf8')).toBe('before')
      expect(await readAccessMetadata(parent)).toEqual(acl)
      expect(await readAccessMetadata(file)).toEqual(fileAcl)
    } finally {
      await writeAccessMetadata(parent, original!)
      await writeAccessMetadata(file, originalFile!)
    }
  },
)
it('AC-8/10 Windows direct-file creation does not demand subdirectory creation rights', async () => {
  if (process.platform !== 'win32') return
  const parent = join(dir(), 'locked')
  await mkdir(parent)
  const original = await readAccessMetadata(parent)
  await writeAccessMetadata(parent, await accessMetadataFromSddl('D:P(D;;0x00000004;;;WD)(A;;FA;;;OW)(A;;FA;;;SY)'))
  try {
    await prepareTransaction(dir(), [{path: 'locked/a.md', content: 'after'}])
    expect(await readdir(parent)).toEqual([])
    await expect(prepareTransaction(dir(), [{path: 'locked/new/a.md', content: 'after'}])).rejects.toThrow(
      'Directory creation access denied',
    )
    expect(await readdir(parent)).toEqual([])
  } finally {
    await writeAccessMetadata(parent, original!)
  }
})
// Inheritable owner/SYSTEM access keeps existing and newly created children usable.
const inheritedOwnerAccess = '(A;OICI;FA;;;OW)(A;OICI;FA;;;SY)'
const lockedDacl = (deny: string) => `D:P${deny}${inheritedOwnerAccess}`
const fileDeny = '(D;;0x00000002;;;WD)',
  subdirectoryDeny = '(D;;0x00000004;;;WD)'
it.each([
  ['writable directory, new file', '', 'locked/new.md', 'allowed'],
  ['file creation denied, new file', fileDeny, 'locked/new.md', 'denied'],
  ['file creation denied, replacement', fileDeny, 'locked/a.md', 'denied'],
  ['file creation denied, file in a new subdirectory', fileDeny, 'locked/new/a.md', 'allowed'],
  ['subdirectory creation denied, new file', subdirectoryDeny, 'locked/new.md', 'allowed'],
  ['subdirectory creation denied, file in a new subdirectory', subdirectoryDeny, 'locked/new/a.md', 'denied'],
  // New directories inherit these ACEs, so the denial applies one or more levels below the existing parent.
  ['inherited file creation deny, file in a new subdirectory', '(D;OICI;0x00000002;;;WD)', 'locked/new/a.md', 'denied'],
  [
    'inherit-only subdirectory deny, file one new level down',
    '(D;OICIIO;0x00000004;;;WD)',
    'locked/new/a.md',
    'allowed',
  ],
  [
    'inherit-only subdirectory deny, file two new levels down',
    '(D;OICIIO;0x00000004;;;WD)',
    'locked/new/sub/a.md',
    'denied',
  ],
] as const)(
  'AC-8/10 Windows preflight verdict matches the native write outcome: %s',
  async (_, deny, path, expected) => {
    if (process.platform !== 'win32') return
    const parent = join(dir(), 'locked')
    await mkdir(parent)
    await writeFile(join(parent, 'a.md'), 'before')
    const original = await readAccessMetadata(parent)
    await writeAccessMetadata(parent, await accessMetadataFromSddl(lockedDacl(deny)))
    try {
      const before = await readdir(parent),
        acl = await readAccessMetadata(parent)
      const operations = [{path, content: 'after'}]
      const preflight = await prepareTransaction(dir(), operations).then(
        () => 'allowed',
        (error: Error) => {
          expect(error.message).toContain('Directory creation access denied')
          return 'denied'
        },
      )
      expect(await readdir(parent)).toEqual(before)
      // Bypass only the preflight so the native file APIs decide the apply outcome.
      const native = await prepareTransaction(dir(), operations, {
        ...transactionIO,
        checkDirectoryCreationAccess: async () => {},
      })
        .then((prepared) => prepared.commit())
        .then(
          () => 'allowed',
          (error: unknown) => {
            expect(error).toBeInstanceOf(TransactionError)
            expect((error as Error).message).toMatch(/Private exclusive Windows creation refused|EPERM|EACCES/)
            return 'denied'
          },
        )
      expect({preflight, native}).toEqual({preflight: expected, native: expected})
      expect(await readAccessMetadata(parent)).toEqual(acl)
      if (expected === 'denied') {
        expect(await readdir(parent)).toEqual(before)
        expect(await readFile(join(parent, 'a.md'), 'utf8')).toBe('before')
      } else expect(await readFile(join(dir(), path), 'utf8')).toBe('after')
    } finally {
      await writeAccessMetadata(parent, original!)
    }
  },
)
it.each(['new file', 'replacement'])(
  'AC-8/10 a write denial that appears after a passing preflight fails at apply and rolls back: %s',
  async (kind) => {
    const parent = join(dir(), 'locked'),
      open = join(dir(), 'open')
    await mkdir(parent)
    await mkdir(open)
    if (kind === 'replacement') await writeFile(join(parent, 'a.md'), 'before')
    const before = await readdir(parent)
    const original = await readAccessMetadata(parent)
    const prepared = await prepareTransaction(dir(), [
      {path: 'open/b.md', content: 'neighbor'},
      {path: kind === 'replacement' ? 'locked/a.md' : 'locked/new.md', content: 'after'},
    ])
    if (process.platform === 'win32')
      await writeAccessMetadata(parent, await accessMetadataFromSddl(lockedDacl('(D;;0x00000006;;;WD)')))
    else await chmod(parent, 0o500)
    try {
      // The target was never replaced, so compensation must not report it as unrestored.
      await expect(prepared.commit()).rejects.toThrow('Rollback complete')
      expect(await readdir(open)).toEqual([])
      expect(await readdir(parent)).toEqual(before)
      if (kind === 'replacement') expect(await readFile(join(parent, 'a.md'), 'utf8')).toBe('before')
    } finally {
      if (process.platform === 'win32') await writeAccessMetadata(parent, original!)
      else await chmod(parent, 0o700)
    }
  },
)
it.each(['replace', 'delete', 'create'])('AC-8,10 preflight refuses unwritable POSIX parents: %s', async (kind) => {
  if (process.platform === 'win32') return
  const parent = join(dir(), 'locked')
  await mkdir(parent)
  if (kind !== 'create') await writeFile(join(parent, 'a.md'), 'before')
  await chmod(parent, 0o500)
  try {
    await expect(access(parent, constants.W_OK)).rejects.toThrow()
    await expect(
      prepareTransaction(dir(), [
        {path: kind === 'create' ? 'locked/new/a.md' : 'locked/a.md', content: kind === 'delete' ? null : 'after'},
      ]),
    ).rejects.toThrow()
  } finally {
    await chmod(parent, 0o700)
  }
})
