import {chmod, mkdir, readdir, readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {protectedBytes} from '@test-helpers/sync-fixture'
import {useTmpDir} from '@test-helpers/tmp'
import {accessMetadataFromSddl} from '@test-helpers/windows-access'
import {expect, it} from 'bun:test'

import {readAccessMetadata, writeAccessMetadata} from '@infrastructure/fs/windows-access'

import {command, config} from './helpers'

const dir = useTmpDir('preview-permissions')
// Inheritable owner/SYSTEM access keeps existing children readable after the
// protected directory DACL replaces what they inherited.
const lockedDacl = (denied: boolean) => `D:P${denied ? '(D;;0x00000006;;;WD)' : ''}(A;OICI;FA;;;OW)(A;OICI;FA;;;SY)`
const windowsLocations = {
  'new target': {locked: '.claude/rules', initial: false, localEdit: false},
  'updated target and adjacent backup': {locked: '.claude/rules', initial: true, localEdit: true},
  'state and config metadata': {locked: '.crucible', initial: true, localEdit: false},
} as const
async function accessSnapshot(directory: string) {
  const result: Record<string, Uint8Array | null> = {'.': await readAccessMetadata(directory)}
  for (const name of (await readdir(directory)).sort()) result[name] = await readAccessMetadata(join(directory, name))
  return result
}
it.each(
  Object.keys(windowsLocations).flatMap((location) => [true, false].map((denied) => [location, denied] as const)),
)('AC-8/10 Windows preview and apply agree for %s, creation denied=%p', async (location, denied) => {
  if (process.platform !== 'win32') return
  const {locked, initial, localEdit} = windowsLocations[location as keyof typeof windowsLocations]
  const root = dir(),
    source = join(root, 'source'),
    target = join(root, '.claude/rules/a.md'),
    lockedPath = join(root, locked)
  await mkdir(join(source, 'rules'), {recursive: true})
  await writeFile(join(source, 'rules/a.md'), initial ? 'first' : 'after')
  await config(root, [{name: 'team', type: 'local', path: source}])
  await mkdir(join(root, '.claude/rules'), {recursive: true})
  if (initial) {
    const first = await command(root)
    expect(first, JSON.stringify(first)).toMatchObject({exitCode: 0})
    await writeFile(join(source, 'rules/a.md'), 'after')
  }
  if (localEdit) await writeFile(target, 'local edit')
  const original = await readAccessMetadata(lockedPath)
  await writeAccessMetadata(lockedPath, await accessMetadataFromSddl(lockedDacl(denied)))
  try {
    const before = await protectedBytes(root),
      access = await accessSnapshot(lockedPath)
    const preview = await command(root, ['sync', '--dry-run'])
    expect(preview, JSON.stringify(preview)).toMatchObject({exitCode: denied ? 1 : 0, signal: null, timedOut: false})
    expect(await protectedBytes(root)).toEqual(before)
    const apply = await command(root, ['sync'])
    expect(apply, JSON.stringify(apply)).toMatchObject({exitCode: preview.exitCode, signal: null, timedOut: false})
    if (denied) {
      for (const result of [preview, apply])
        expect(result.stdout + result.stderr).toContain('Directory creation access denied')
      expect(await protectedBytes(root)).toEqual(before)
    } else {
      expect(await readFile(target, 'utf8')).toBe('after')
      if (localEdit) expect(await readFile(`${target}.bak`, 'utf8')).toBe('local edit')
    }
    // Existing entries keep their exact DACL; entries created by apply are not compared.
    const after = await accessSnapshot(lockedPath)
    for (const [name, descriptor] of Object.entries(access)) expect(after[name]).toEqual(descriptor)
  } finally {
    await writeAccessMetadata(lockedPath, original!)
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
