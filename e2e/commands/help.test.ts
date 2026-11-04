import {existsSync} from 'node:fs'
import {join, resolve} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {expect, it} from 'bun:test'

import {spawnPty} from '@e2e/framework/spawn'

const dir = useTmpDir('human-help')
it('human help exits without prompting or persisting config (AC-29)', async () => {
  const session = spawnPty(dir(), [process.execPath, resolve(import.meta.dir, '../../src/main.ts'), '--help'])
  try {
    await session.waitForText('Usage:')
    const result = await session.waitForExit()
    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('Commands:')
    expect(result.output).toContain('sync')
    expect(result.output).toContain('--help')
    expect(existsSync(join(dir(), '.crucible/forge.config.yaml'))).toBe(false)
  } finally {
    await session.dispose()
  }
})
