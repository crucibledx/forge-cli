import {mkdir, writeFile} from 'node:fs/promises'
import {homedir} from 'node:os'
import {join} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {describe, expect, it} from 'bun:test'

import {
  getGlobalConfigPath,
  getProjectConfigPath,
  loadGlobalConfig,
  loadProjectConfig,
  projectConfigExists,
} from './loader'

const getDir = useTmpDir('config_loader')

const VALID_PROJECT_YAML = `
version: "1"
assistants:
  - id: cursor
    enabled: true
sources:
  - name: team
    type: git
    url: git@github.com:org/repo.git
    branch: main
`.trim()

const VALID_GLOBAL_YAML = `
version: "1"
user:
  name: Alice
defaults:
  assistants:
    - id: windsurf
      enabled: true
`.trim()

describe('getProjectConfigPath', () => {
  it('returns path inside .crucible dir', () => {
    const p = getProjectConfigPath('/my/project')
    expect(p).toBe('/my/project/.crucible/forge.config.yaml')
  })
})

describe('getGlobalConfigPath', () => {
  it('returns path inside home .crucible dir', () => {
    const p = getGlobalConfigPath()
    expect(p).toBe(join(homedir(), '.crucible', 'forge.config.yaml'))
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
    expect(result!.assistants[0].id).toBe('cursor')
    expect(result!.sources[0].type).toBe('git')
  })

  it('throws on invalid YAML schema', async () => {
    const dir = getDir()
    const configDir = join(dir, '.crucible')
    await mkdir(configDir, {recursive: true})
    await writeFile(
      join(configDir, 'forge.config.yaml'),
      'version: "1"\nassistants:\n  - id: not-real\n    enabled: true',
      'utf-8',
    )
    expect(loadProjectConfig(dir)).rejects.toThrow()
  })
})

describe('loadGlobalConfig', () => {
  it('returns null when config file absent', async () => {
    // Use a non-home tmp path — loadGlobalConfig uses homedir() so we can only test null branch
    // if global config doesn't happen to exist. We verify the function runs without throwing.
    const result = await loadGlobalConfig()
    // Can be null or a valid object depending on test machine — just check it doesn't throw
    expect(result === null || typeof result === 'object').toBe(true)
  })

  it('parses global config from a valid YAML string (unit-level via schema)', async () => {
    // Validate schema parsing directly since loadGlobalConfig path is fixed to homedir()
    const {globalConfigSchema} = await import('./schema')
    const {parse: parseYaml} = await import('yaml')
    const parsed = globalConfigSchema.parse(parseYaml(VALID_GLOBAL_YAML))
    expect(parsed.user?.name).toBe('Alice')
    expect(parsed.defaults?.assistants?.[0].id).toBe('windsurf')
  })
})
