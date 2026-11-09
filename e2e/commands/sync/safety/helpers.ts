import {existsSync} from 'node:fs'
import {mkdir, readdir, readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {stringify} from 'yaml'

import type {ProjectConfig, Source} from '@domain/config/types'
import {CLI_ENTRY} from '@e2e/framework/constants'
import {runPipe} from '@e2e/framework/pipe'

export const command = (root: string, args = ['sync']) => runPipe(root, [process.execPath, CLI_ENTRY, ...args])
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
export async function readTree(root: string): Promise<string> {
  if (!existsSync(root)) return ''
  let text = ''
  for (const entry of await readdir(root, {withFileTypes: true})) {
    const path = join(root, entry.name)
    text += entry.isDirectory() ? await readTree(path) : await readFile(path, 'utf8')
  }
  return text
}
