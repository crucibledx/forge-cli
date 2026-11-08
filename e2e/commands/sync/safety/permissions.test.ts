import {chmod, mkdir, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {protectedBytes} from '@test-helpers/sync-fixture'
import {useTmpDir} from '@test-helpers/tmp'
import {accessMetadataFromSddl} from '@test-helpers/windows-access'
import {expect, it} from 'bun:test'

import {readAccessMetadata, writeAccessMetadata} from '@infrastructure/fs/windows-access'

import {command, config} from './helpers'

const dir = useTmpDir('preview-permissions')
it('AC-8/10 Windows preview and apply reject denied directory creation without protected mutation', async () => {
  if (process.platform !== 'win32') return
  const source = join(dir(), 'source'),
    parent = join(dir(), '.claude/rules')
  await mkdir(join(source, 'rules'), {recursive: true})
  await writeFile(join(source, 'rules/a.md'), 'after')
  await config(dir(), [{name: 'team', type: 'local', path: source}])
  await mkdir(parent, {recursive: true})
  const original = await readAccessMetadata(parent)
  await writeAccessMetadata(parent, await accessMetadataFromSddl('D:P(D;;0x00000006;;;WD)(A;;FA;;;OW)(A;;FA;;;SY)'))
  try {
    const before = await protectedBytes(dir())
    for (const args of [['sync', '--dry-run'], ['sync']]) {
      const result = await command(dir(), args)
      expect(result, JSON.stringify(result)).toMatchObject({exitCode: 1, signal: null, timedOut: false})
      expect(result.stdout + result.stderr).toContain('Directory creation access denied')
      expect(await protectedBytes(dir())).toEqual(before)
    }
  } finally {
    await writeAccessMetadata(parent, original!)
  }
})
it('AC-8,10 real preview and apply both refuse replacement permission failure without protected mutations', async () => {
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
