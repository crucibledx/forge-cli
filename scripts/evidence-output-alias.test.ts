import {link, readFile, writeFile} from 'node:fs/promises'
import {join, resolve} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {expect, it} from 'bun:test'

import {runPipe} from '../e2e/framework/pipe'
import {protectEvidenceOutput} from './evidence-io'
import {fixtureProvider, readinessFixture} from './fixtures/readiness'
import {readinessCLI} from './readiness'

const dir = useTmpDir('evidence-output-alias')
const aliases = [
  {input: 'readiness.json', output: 'READINESS.json'},
  {input: 'café.json', output: 'cafe\u0301.json'},
  {input: 'straße.json', output: 'STRASSE.json'},
]
it.each(aliases)('AC-26,27,30,32 portable source alias $input / $output is never an output', ({input, output}) => {
  expect(() => protectEvidenceOutput(join(dir(), input), join(dir(), output))).toThrow(
    'Output cannot overwrite source attestations',
  )
})
it.each(
  [
    ...aliases.map((alias) => ({...alias, linked: false})),
    {input: 'readiness.json', output: 'linked.json', linked: true},
  ].flatMap((alias) => [false, true].map((malformed) => ({...alias, malformed}))),
)(
  'AC-26,27,30,32 $input / $output preserves private source bytes before cleanup, malformed=$malformed',
  async ({input: name, output: alias, linked, malformed}) => {
    const input = join(dir(), name),
      output = join(dir(), alias),
      original = malformed
        ? '{invalid AM_SOURCE_PRIVATE'
        : JSON.stringify({
            schema_version: 1,
            verdict: 'blocked',
            ac_results: [],
            lane_results: [],
            private: 'AM_SOURCE_PRIVATE',
          })
    await writeFile(input, original)
    if (linked) await link(input, output)
    expect(await readinessCLI(['--input', input, '--output', output], fixtureProvider(dir(), readinessFixture()))).toBe(
      2,
    )
    expect(await readFile(input, 'utf8')).toBe(original)
    const result = await runPipe(dir(), [
      process.execPath,
      resolve(import.meta.dir, 'check-readiness.ts'),
      '--input',
      input,
      '--output',
      output,
    ])
    expect(result.exitCode).toBe(2)
    expect(result.stderr).toContain('Output cannot overwrite source attestations')
    expect(result.stdout + result.stderr).not.toContain('AM_SOURCE_PRIVATE')
    expect(await readFile(input, 'utf8')).toBe(original)
    const collected = await runPipe(dir(), [
      process.execPath,
      resolve(import.meta.dir, 'collect-readiness.ts'),
      '--context',
      input,
      '--out',
      output,
    ])
    expect(collected.exitCode).toBe(2)
    expect(collected.stderr).toContain('Output cannot overwrite source attestations')
    expect(collected.stdout + collected.stderr).not.toContain('AM_SOURCE_PRIVATE')
    expect(await readFile(input, 'utf8')).toBe(original)
    if (linked) expect(await readFile(output, 'utf8')).toBe(original)
  },
)
