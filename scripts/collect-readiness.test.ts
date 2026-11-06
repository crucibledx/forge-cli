import {existsSync} from 'node:fs'
import {mkdir, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {expect, it} from 'bun:test'

import {runPipe} from '../e2e/framework/pipe'
import {readinessFixture} from './fixtures/readiness'

const dir = useTmpDir('collector-location')
it.each(['colocated', 'relocated', 'overwrite'])('AC-32 collector evidence-root relationship: %s', async (kind) => {
  const selected = join(dir(), 'selected')
  await mkdir(selected)
  const context = join(selected, 'context.json')
  const bytes = JSON.stringify(readinessFixture().context)
  await writeFile(context, bytes)
  const output = kind === 'overwrite' ? context : join(kind === 'relocated' ? dir() : selected, 'bundle.json')
  const result = await runPipe(dir(), [
    process.execPath,
    join(import.meta.dir, 'collect-readiness.ts'),
    '--context',
    context,
    '--out',
    output,
  ])
  expect(result.exitCode).toBe(2)
  expect(result.stderr).toContain(
    kind === 'relocated'
      ? 'must be colocated'
      : kind === 'overwrite'
        ? 'cannot overwrite'
        : 'does not match the actual tested checkout',
  )
  if (kind !== 'overwrite') expect(existsSync(output)).toBe(false)
  expect(await Bun.file(context).text()).toBe(bytes)
})
