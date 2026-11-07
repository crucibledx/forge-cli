import {constants} from 'node:fs'
import {access, chmod, mkdir, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {expect, it} from 'bun:test'

import {prepareTransaction} from './transaction'

const dir = useTmpDir('transaction-permissions')
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
