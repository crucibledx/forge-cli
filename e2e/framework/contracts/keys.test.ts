import {join} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {expect, it} from 'bun:test'

import {spawnPty} from '../spawn'

const dir = useTmpDir('keys')
it('preserves physical terminal editing keys', async () => {
  const cli = spawnPty(dir(), [process.execPath, join(import.meta.dir, 'fixtures/process.ts'), 'keys'])
  await cli.waitForText('ready').pressKey('\x7f').waitForText('"name"').pressKey('q')
  const result = await cli.waitForExit()
  expect(result.output).toContain('"name":"backspace"')
})
