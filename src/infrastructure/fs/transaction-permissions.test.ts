import {constants} from 'node:fs'
import {access, chmod, mkdir, readdir, readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {accessMetadataFromSddl} from '@test-helpers/windows-access'
import {expect, it} from 'bun:test'

import {prepareTransaction} from './transaction'
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
