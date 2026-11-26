import {mkdir, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {describe, expect, it} from 'bun:test'

import {COVER_ALL_DIR, COVER_ALL_EXPECTED, PLUGIN_SCHEMA_ID} from '@e2e/fixtures/plugin-packages'
import {runCommand, useTmpDir} from '@e2e/framework'

const dir = useTmpDir('forge-plugin-validate')
const validate = (args: string[]) => runCommand(dir(), 'plugin', ['validate', ...args])
async function writePackage(manifest: object): Promise<string> {
  const path = join(dir(), 'pkg')
  await mkdir(path, {recursive: true})
  await writeFile(join(path, 'plugin.json'), JSON.stringify(manifest))
  return path
}

describe('forge plugin validate', () => {
  it('AC-1,7 accepts cover-all and prints every adaptation and drop per harness', async () => {
    const expected: Record<string, Array<Record<string, string>>> = await Bun.file(COVER_ALL_EXPECTED).json()
    const result = await validate([COVER_ALL_DIR])
    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('Plugin cover-all@1.0.0 is valid')
    for (const [harness, entries] of Object.entries(expected)) {
      expect(result.output).toContain(`Portability for ${harness}:`)
      for (const e of entries) expect(result.output).toContain(`${e.status} ${e.kind} ${e.name}: ${e.detail}`)
    }
  })
  it('AC-7 --json carries the same portability report', async () => {
    const result = await validate([COVER_ALL_DIR, '--json'])
    expect(result.exitCode).toBe(0)
    expect(JSON.parse(result.stdout)).toEqual({
      valid: true,
      name: 'cover-all',
      version: '1.0.0',
      errors: [],
      warnings: [],
      portability: await Bun.file(COVER_ALL_EXPECTED).json(),
    })
  })
  it('AC-1 fails on a missing $schema and a non-semver version, naming each', async () => {
    await writePackage({name: 'demo', version: '1.0'})
    const result = await validate(['pkg'])
    expect(result.exitCode).toBe(1)
    expect(result.output).toContain('plugin.json: missing required field "$schema"')
    expect(result.output).toContain('"version" must be a semantic version')
    expect(result.output).toContain('Plugin package is invalid: pkg')
    const json = await validate(['pkg', '--json'])
    expect(json.exitCode).toBe(1)
    expect(JSON.parse(json.stdout)).toMatchObject({valid: false, portability: {}})
  })
  it('AC-1 warns on an unknown top-level field without failing', async () => {
    await writePackage({$schema: PLUGIN_SCHEMA_ID, name: 'demo', version: '1.0.0', engines: {}})
    const result = await validate(['pkg'])
    expect(result.exitCode).toBe(0)
    expect(result.output).toContain('unknown top-level field "engines" ignored')
    expect(result.output).toContain('Plugin demo@1.0.0 is valid')
  })
})
