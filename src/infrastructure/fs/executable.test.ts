import {chmod, mkdir, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {describe, expect, it} from 'bun:test'

const dir = useTmpDir('executable')
const MODULE = join(import.meta.dir, 'executable.ts')

/**
 * Probe executableOnPath in a fresh runtime: the resolver reads PATH once per process (and the test launcher
 * itself runs with a Bun-provided node shim on PATH), so in-process PATH changes cannot exercise it.
 */
async function probe(path: string): Promise<boolean> {
  const proc = Bun.spawn(
    [
      process.execPath,
      '-e',
      `import {executableOnPath} from ${JSON.stringify(MODULE)}; console.log(executableOnPath('node'))`,
    ],
    {
      env: {...process.env, PATH: path},
      stdout: 'pipe',
      stderr: 'inherit',
    },
  )
  const out = await new Response(proc.stdout).text()
  await proc.exited
  return out.trim() === 'true'
}

describe('executableOnPath', () => {
  it('does not mistake a directory on PATH for the executable', async () => {
    const bin = join(dir(), 'bin')
    await mkdir(join(bin, 'node'), {recursive: true})
    expect(await probe(bin)).toBe(false)
  })

  it('finds a runnable file on PATH and misses an absent one', async () => {
    const bin = join(dir(), 'bin')
    await mkdir(bin, {recursive: true})
    if (process.platform === 'win32') await writeFile(join(bin, 'node.cmd'), '@exit /b 0\r\n')
    else {
      await writeFile(join(bin, 'node'), '#!/bin/sh\nexit 0\n')
      await chmod(join(bin, 'node'), 0o755)
    }
    expect(await probe(bin)).toBe(true)
    expect(await probe(join(dir(), 'empty'))).toBe(false)
  })

  it.skipIf(process.platform === 'win32')('ignores a file without the executable bit', async () => {
    const bin = join(dir(), 'bin')
    await mkdir(bin, {recursive: true})
    await writeFile(join(bin, 'node'), '#!/bin/sh\nexit 0\n', {mode: 0o644})
    expect(await probe(bin)).toBe(false)
  })
})
