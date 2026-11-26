import {mkdir, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {describe, expect, it} from 'bun:test'

import {getProjectConfigPath, loadProjectConfig, projectConfigExists} from './loader'

const getDir = useTmpDir('config_loader')

const VALID_PROJECT_YAML = `
version: "1"
harnesses:
  - id: cursor
    enabled: true
sources:
  - name: team
    type: git
    url: git@github.com:org/repo.git
    branch: main
`.trim()

describe('getProjectConfigPath', () => {
  it('returns path inside .crucible dir', () => {
    const p = getProjectConfigPath('/my/project')
    expect(p).toBe('/my/project/.crucible/forge.config.yaml')
  })
})

describe('projectConfigExists', () => {
  it('returns false when config file absent', () => {
    expect(projectConfigExists(getDir())).toBe(false)
  })

  it('returns true when config file exists', async () => {
    const configDir = join(getDir(), '.crucible')
    await mkdir(configDir, {recursive: true})
    await writeFile(join(configDir, 'forge.config.yaml'), VALID_PROJECT_YAML, 'utf-8')
    expect(projectConfigExists(getDir())).toBe(true)
  })
})

describe('loadProjectConfig', () => {
  it('returns null when config file absent', async () => {
    const result = await loadProjectConfig(getDir())
    expect(result).toBeNull()
  })

  it('parses and returns config when file exists', async () => {
    const dir = getDir()
    const configDir = join(dir, '.crucible')
    await mkdir(configDir, {recursive: true})
    await writeFile(join(configDir, 'forge.config.yaml'), VALID_PROJECT_YAML, 'utf-8')

    const result = await loadProjectConfig(dir)
    expect(result).not.toBeNull()
    expect(result!.version).toBe('1')
    expect(result!.harnesses[0].id).toBe('cursor')
    expect(result!.sources[0].type).toBe('git')
  })

  it('throws on invalid YAML schema', async () => {
    const dir = getDir()
    const configDir = join(dir, '.crucible')
    await mkdir(configDir, {recursive: true})
    await writeFile(
      join(configDir, 'forge.config.yaml'),
      'version: "1"\nharnesses:\n  - id: not-real\n    enabled: true',
      'utf-8',
    )
    expect(loadProjectConfig(dir)).rejects.toThrow()
  })
})

describe('loadProjectConfig with the assistants alias', () => {
  const V07_YAML = 'version: "1"\nassistants:\n  - id: cursor\n    enabled: true\nsources: []\n'

  async function load(yaml: string) {
    const dir = getDir()
    await mkdir(join(dir, '.crucible'), {recursive: true})
    await writeFile(join(dir, '.crucible', 'forge.config.yaml'), yaml, 'utf-8')
    return loadProjectConfig(dir)
  }

  it('reads a v0.7 config with only assistants: as harnesses', async () => {
    const config = await load(V07_YAML)
    expect(config!.harnesses).toEqual([{id: 'cursor', enabled: true}])
    expect(config).not.toHaveProperty('assistants')
  })

  it('loads the v0.7 config to the same result as its harnesses: spelling', async () => {
    expect(await load(V07_YAML)).toEqual(await load(V07_YAML.replace('assistants:', 'harnesses:')))
  })

  it('fails when both assistants: and harnesses: are present, naming both keys', async () => {
    const both = V07_YAML + 'harnesses:\n  - id: cline\n    enabled: true\n'
    const error = await load(both).catch((e: Error) => e)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toContain('`harnesses:`')
    expect((error as Error).message).toContain('`assistants:`')
  })
})
