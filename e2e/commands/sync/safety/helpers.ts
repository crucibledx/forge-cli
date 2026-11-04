import {existsSync} from 'node:fs'
import {mkdir, readdir, readFile, writeFile} from 'node:fs/promises'
import {join, resolve} from 'node:path'

import {snapshot} from '@test-helpers/snapshot'
import {stringify} from 'yaml'

import type {ProjectConfig, Source} from '@domain/config/types'
import {runPipe} from '@e2e/framework/pipe'

const cli = resolve(import.meta.dir, '../../../../src/main.ts')
export const command = (root: string, args = ['sync']) => runPipe(root, [process.execPath, cli, ...args])
export async function config(root: string, sources: Source[], sync: Partial<ProjectConfig['sync']> = {}) {
  await mkdir(join(root, '.crucible'), {recursive: true})
  await writeFile(
    join(root, '.crucible/forge.config.yaml'),
    stringify({
      version: '1',
      assistants: [{id: 'claude-code', enabled: true}],
      sources,
      sync: {keep_local: false, ...sync},
    }),
  )
}
export async function protectedBytes(root: string) {
  const result: Record<string, Awaited<ReturnType<typeof snapshot>>> = {}
  for (const path of ['.claude', '.crucible'])
    if (existsSync(join(root, path))) result[path] = await snapshot(join(root, path))
  return result
}
export async function readTree(root: string): Promise<string> {
  if (!existsSync(root)) return ''
  let text = ''
  for (const entry of await readdir(root, {withFileTypes: true})) {
    const path = join(root, entry.name)
    text += entry.isDirectory() ? await readTree(path) : await readFile(path, 'utf8')
  }
  return text
}
