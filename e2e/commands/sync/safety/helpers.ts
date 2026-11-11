import {existsSync} from 'node:fs'
import {mkdir, readdir, readFile, writeFile} from 'node:fs/promises'
import {dirname, join} from 'node:path'

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
// Bun's realpath normalizes backslashes on POSIX. Create and inspect both real names natively.
const nativeInspect = '/bin/cat "$1"; printf "\\n"; /bin/cat "$2"; printf "\\n"'
export const nativePairBytes = 'literal owned bytes\nUNRELATED USER BYTES\n'
export const readNativePair = (root: string, paths: string[]) =>
  runPipe(root, ['/bin/sh', '-c', nativeInspect, 'forge-native-fixture', ...paths])
/** Writes a literal-backslash file and the distinct nested file its separator-normalized key would name. */
export async function writeAmbiguousPair(root: string, literal: string): Promise<string[]> {
  const paths = [join(root, literal), join(root, literal.replaceAll('\\', '/'))]
  await mkdir(dirname(paths[1]), {recursive: true})
  const write = 'printf "%s" "literal owned bytes" > "$1" && printf "%s" "UNRELATED USER BYTES" > "$2"'
  const result = await runPipe(root, ['/bin/sh', '-c', write, 'forge-native-fixture', ...paths])
  if (result.exitCode !== 0) throw new Error(`Native fixture failed: ${JSON.stringify(result)}`)
  return paths
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
