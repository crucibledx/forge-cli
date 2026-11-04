import {lstat, readdir, readFile} from 'node:fs/promises'
import {join} from 'node:path'

/** Compare protected bytes, existence, directories and supported permission bits. */
export async function snapshot(root: string): Promise<Record<string, {bytes?: string; mode: number}>> {
  const result: Record<string, {bytes?: string; mode: number}> = {}
  async function visit(path: string) {
    for (const name of (await readdir(join(root, path))).sort()) {
      const key = path ? `${path}/${name}` : name
      const full = join(root, key)
      const info = await lstat(full)
      result[key] = {mode: info.mode & 0o7777}
      if (info.isDirectory()) await visit(key)
      else if (info.isFile()) result[key].bytes = (await readFile(full)).toString('base64')
    }
  }
  await visit('')
  return result
}
