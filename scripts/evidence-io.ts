import {mkdir, readFile, rename, unlink, writeFile} from 'node:fs/promises'
import {dirname, resolve} from 'node:path'

import {createConfinement} from '../src/infrastructure/fs/confinement'

export async function writeEvidence(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), {recursive: true, mode: 0o700})
  const boundary = await createConfinement(dirname(path))
  const destination = await boundary.resolve(resolve(path))
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
  const bytes = await readFile(resolved)
  if (bytes.length > 2 * 1024 * 1024) throw new Error(`Oversized evidence: ${path}`)
  return bytes.toString('utf8')
}
