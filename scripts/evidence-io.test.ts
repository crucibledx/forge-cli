import {open, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {expect, it} from 'bun:test'

import {readEvidence} from './evidence-io'
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
