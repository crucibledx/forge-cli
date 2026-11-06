import {constants} from 'node:fs'
import {access, chmod, mkdir, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {protectedBytes} from '@test-helpers/sync-fixture'
import {useTmpDir} from '@test-helpers/tmp'
import {expect, it} from 'bun:test'

import {prepareTransaction} from '@infrastructure/fs/transaction'

import {command, config} from './helpers'

const dir = useTmpDir('preview-permissions')
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
it('AC-8 real preview and apply both refuse replacement permission failure without protected mutations', async () => {
  if (process.platform === 'win32') return
  const source = join(dir(), 'source')
  await mkdir(join(source, 'rules'), {recursive: true})
  await writeFile(join(source, 'rules/a.md'), 'after')
  await config(dir(), [{name: 'team', type: 'local', path: source}])
  const parent = join(dir(), '.claude/rules')
  await mkdir(parent, {recursive: true})
  await writeFile(join(parent, 'a.md'), 'before')
  await chmod(parent, 0o500)
  try {
    const before = await protectedBytes(dir())
    for (const args of [['sync', '--dry-run'], ['sync']]) {
      const result = await command(dir(), args)
      expect(result.exitCode).toBe(1)
      expect(result.stdout + result.stderr).toContain('EACCES')
      expect(await protectedBytes(dir())).toEqual(before)
    }
  } finally {
    await chmod(parent, 0o700)
  }
})
