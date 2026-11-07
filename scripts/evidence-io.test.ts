import {mkdir, open, readdir, readFile, symlink, writeFile} from 'node:fs/promises'
import {dirname, join} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {expect, it} from 'bun:test'

import {readEvidence, writeEvidence} from './evidence-io'
import {MAX_EVIDENCE_BYTES} from './validation-evidence'

const dir = useTmpDir('evidence-reader')
it('AC-27 evidence reads preserve empty, Unicode and exact-limit bytes', async () => {
  for (const text of ['', 'é😀\0', 'x'.repeat(MAX_EVIDENCE_BYTES)]) {
    await writeFile(join(dir(), 'check.log'), text)
    expect(await readEvidence(dir(), 'check.log')).toBe(text)
  }
})
it.each([MAX_EVIDENCE_BYTES + 1, 64 * 1024 * 1024])(
  'AC-27 evidence size %s is refused without buffering the oversized file',
  async (size) => {
    const path = join(dir(), 'oversized.log')
    const file = await open(path, 'w')
    try {
      await file.truncate(size)
    } finally {
      await file.close()
    }
    await expect(readEvidence(dir(), 'oversized.log')).rejects.toThrow('Oversized evidence: oversized.log')
    // Rejection closes its handle and never poisons the next legitimate read.
    await writeFile(path, 'visible-after-rejection')
    expect(await readEvidence(dir(), 'oversized.log')).toBe('visible-after-rejection')
  },
)

it.each(['raw-reports', 'checks/quality'])(
  'AC-26 AC-30 additional evidence-write security refuses a nested pre-existing junction/symlink: %s',
  async (folder) => {
    const root = join(dir(), 'selected'),
      outside = join(dir(), 'outside')
    await mkdir(root)
    await mkdir(outside)
    await mkdir(dirname(join(root, folder)), {recursive: true})
    await writeFile(join(outside, '777.json'), 'outside sentinel')
    await symlink(outside, join(root, folder), 'junction')
    await expect(writeEvidence(join(root, folder, '777.json'), {markdown: 'report'}, root)).rejects.toThrow()
    expect(await readFile(join(outside, '777.json'), 'utf8')).toBe('outside sentinel')
    await expect(writeEvidence(join(root, folder, 'new/deep/777.json'), {}, root)).rejects.toThrow()
    expect(await Bun.file(join(outside, 'new/deep/777.json')).exists()).toBe(false)
    expect(await readdir(outside)).toEqual(['777.json'])
  },
)
it('AC-27 evidence writes support nested Unicode content, a trusted symlink root and legacy top-level output', async () => {
  const root = join(dir(), 'root'),
    alias = join(dir(), 'alias')
  await mkdir(root)
  await symlink(root, alias, 'junction')
  await writeEvidence(join(alias, 'raw-reports/777.json'), {markdown: '東京 é'}, alias)
  expect(JSON.parse(await readFile(join(root, 'raw-reports/777.json'), 'utf8'))).toEqual({markdown: '東京 é'})
  await writeEvidence(join(root, 'output.json'), {value: 'visible'})
  expect(JSON.parse(await readFile(join(root, 'output.json'), 'utf8'))).toEqual({value: 'visible'})
})
it('AC-27 an explicit evidence root rejects an outside destination before changing its bytes', async () => {
  const root = join(dir(), 'root'),
    outside = join(dir(), 'outside.json')
  await mkdir(root)
  await writeFile(outside, 'sentinel')
  await expect(writeEvidence(outside, {}, root)).rejects.toThrow()
  expect(await readFile(outside, 'utf8')).toBe('sentinel')
})
