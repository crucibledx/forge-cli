import {mkdir, open, rename, unlink, writeFile} from 'node:fs/promises'
import {basename, dirname, relative, resolve} from 'node:path'

import {createConfinement} from '../src/infrastructure/fs/confinement'
import {MAX_EVIDENCE_BYTES} from './validation-evidence'
import {requiredLaneIds} from './validation-lanes'

/** Both output CLIs must protect the same original evidence before any writes or cleanup. */
export function protectEvidenceOutput(input: string, output: string): void {
  if (input === output) throw new Error('Output cannot overwrite source attestations')
  const sourceNames = [
    'context.json',
    'verifier.json',
    'producers.json',
    'deviations.json',
    'gate.json',
    ...requiredLaneIds.map((id) => `${id}.json`),
  ]
  const within = relative(dirname(input), output).replaceAll('\\', '/').toLowerCase()
  if (sourceNames.includes(basename(output).toLowerCase()) || /^(reviews|checks|raw-reports)\//.test(within))
    throw new Error('Output cannot overwrite source evidence')
}

export async function writeEvidence(path: string, data: unknown, root = dirname(path)): Promise<void> {
  await mkdir(root, {recursive: true, mode: 0o700})
  const boundary = await createConfinement(root)
  const destination = await boundary.resolve(resolve(path))
  await mkdir(dirname(destination), {recursive: true, mode: 0o700})
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
