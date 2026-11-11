import {mkdir, open, rename, unlink, writeFile} from 'node:fs/promises'
import {dirname, resolve} from 'node:path'

import {createConfinement} from '../src/infrastructure/fs/confinement'
import {MAX_EVIDENCE_BYTES} from './validation-evidence'

export async function writeEvidence(
  path: string,
  data: unknown,
  root = dirname(path),
  options: {exclusive?: boolean} = {},
): Promise<void> {
  await mkdir(root, {recursive: true, mode: 0o700})
  const boundary = await createConfinement(root)
  const destination = await boundary.resolve(resolve(path))
  await mkdir(dirname(destination), {recursive: true, mode: 0o700})
  if (options.exclusive) {
    // Setup fallbacks need no installed packages and must never replace original evidence.
    await writeFile(destination, JSON.stringify(data, null, 2) + '\n', {flag: 'wx', mode: 0o600})
    return
  }
  const temporary = `${destination}.${crypto.randomUUID()}.tmp`
  await boundary.resolve(temporary)
  try {
    await writeFile(temporary, JSON.stringify(data, null, 2) + '\n', {flag: 'wx', mode: 0o600})
    await rename(temporary, destination)
  } finally {
    await unlink(temporary).catch((error) => {
      if (error.code !== 'ENOENT') throw error
    })
  }
}
export async function readEvidence(root: string, path: string): Promise<string> {
  const boundary = await createConfinement(root)
  const resolved = await boundary.resolve(path)
  const file = await open(resolved, 'r')
  try {
    const oversized = () => new Error(`Oversized evidence: ${path}`)
    if ((await file.stat()).size > MAX_EVIDENCE_BYTES) throw oversized()
    // Bound the read too: a file growing after stat must not bypass the memory cap.
    const bytes = Buffer.allocUnsafe(MAX_EVIDENCE_BYTES + 1)
    let length = 0
    while (length < bytes.length) {
      const {bytesRead} = await file.read(bytes, length, bytes.length - length, null)
      if (bytesRead === 0) break
      length += bytesRead
    }
    if (length > MAX_EVIDENCE_BYTES) throw oversized()
    return bytes.subarray(0, length).toString('utf8')
  } finally {
    await file.close()
  }
}
