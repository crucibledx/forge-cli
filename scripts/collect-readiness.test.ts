import {existsSync} from 'node:fs'
import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {expect, it} from 'bun:test'

import {runPipe} from '../e2e/framework/pipe'
import {readinessFixture} from './fixtures/readiness'
import {requiredLaneIds} from './validation-lanes'

const dir = useTmpDir('collector-location')
it('AC-32 an existing bundle is allowed past destination checks, not mistaken for source evidence', async () => {
  const context = join(dir(), 'context.json'),
    output = join(dir(), 'readiness-input.json')
  const bundle = readinessFixture()
  await writeFile(context, JSON.stringify(bundle.context))
  const bytes = JSON.stringify(bundle)
  await writeFile(output, bytes)
  const result = await runPipe(dir(), [
    process.execPath,
    join(import.meta.dir, 'collect-readiness.ts'),
    '--context',
    context,
    '--out',
    output,
  ])
  expect(result.exitCode).toBe(2)
  expect(result.stderr).toContain('does not match the actual tested checkout')
  expect(await readFile(output, 'utf8')).toBe(bytes)
})
it.each([
  'verifier.json',
  'Verifier.json',
  'deviations.json',
  'producers.json',
  'gate.json',
  ...requiredLaneIds.map((id) => `${id}.json`),
  'unrelated.json',
])('AC-32 collector refuses to replace source/non-bundle evidence before provider access: %s', async (name) => {
  const context = join(dir(), 'context.json')
  const output = join(dir(), name)
  const bytes = JSON.stringify({private_source_evidence: true})
  await writeFile(context, JSON.stringify(readinessFixture().context))
  await writeFile(output, bytes)
  const result = await runPipe(dir(), [
    process.execPath,
    join(import.meta.dir, 'collect-readiness.ts'),
    '--context',
    context,
    '--out',
    output,
  ])
  expect(result.exitCode).toBe(2)
  expect(result.stderr).toMatch(/cannot overwrite source evidence|existing non-bundle data/)
  expect(await readFile(output, 'utf8')).toBe(bytes)
  expect(existsSync(join(dir(), 'gate.json'))).toBe(name === 'gate.json')
})
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
