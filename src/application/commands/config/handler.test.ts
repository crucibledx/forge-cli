/**
 * Unit tests for runConfig handler.
 *
 * All I/O is mocked at the infrastructure boundary. Bun requires mock.module()
 * calls before any dynamic import of the module under test.
 *
 * The `sections` array is a mutable export — we mutate it directly instead of
 * mocking the module, which avoids ESM binding issues with Bun's mock.module.
 */

import {afterEach, beforeEach, describe, expect, it, mock} from 'bun:test'

import type {ProjectConfig} from '@domain/config/types'

import {CONFIG_MESSAGES as M} from './messages'
import type {ConfigSectionEntry} from './sections/types'

// ─── Shared mock state ────────────────────────────────────────────────────────

let mockProjectRoot = '/fake/project'
let mockLoadedConfig: ProjectConfig | null = null
let writtenConfig: unknown = null
let promptResponses: Record<string, unknown> = {}
let rendererWarnings: string[] = []

// ─── Mocks ────────────────────────────────────────────────────────────────────

mock.module('@infrastructure/io', () => ({
  default: {
    resolveProjectRoot: () => mockProjectRoot,
  },
}))

mock.module('@infrastructure/config', () => ({
  loadProjectConfig: async () => mockLoadedConfig,
  loadSyncState: async () => ({lastSync: '', files: {}}),
  writeProjectConfig: async (_root: string, config: unknown) => {
    writtenConfig = config
    return `${mockProjectRoot}/.crucible/forge.config.yaml`
  },
  writeSyncState: async () => {},
}))

mock.module('@infrastructure/cli/renderer', () => ({
  renderNewline: () => {},
  renderInfo: () => {},
  renderWarning: (msg: string) => {
    rendererWarnings.push(msg)
  },
  renderSuccess: () => {},
  renderDim: () => {},
  renderError: () => {},
}))

mock.module('@infrastructure/cli/prompts', () => ({
  intro: () => {},
  outro: () => {},
  confirm: async (opts: {message: string}) => {
    const val = promptResponses[opts.message]
    if (Array.isArray(val)) return val.shift() ?? false
    return val ?? false
  },
  select: async (opts: {message: string}) => {
    const val = promptResponses[opts.message]
    if (Array.isArray(val)) return val.shift() ?? ''
    return val ?? ''
  },
}))

// sections is a mutable array — mutate directly instead of mocking the module
import {sections} from './sections'

const originalSections = [...sections]

function setSections(...entries: ConfigSectionEntry[]) {
  sections.length = 0
  sections.push(...entries)
}

// ─── Reset ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockProjectRoot = '/fake/project'
  mockLoadedConfig = null
  writtenConfig = null
  promptResponses = {}
  rendererWarnings = []
  setSections()
})

afterEach(() => {
  setSections(...originalSections)
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('runConfig', () => {
  it('warns and exits when no config exists', async () => {
    mockLoadedConfig = null
    const {runConfig} = await import('./handler')
    await runConfig({verbose: false})
    expect(rendererWarnings).toContain(M.noConfig)
    expect(writtenConfig).toBeNull()
  })

  it('warns and exits when no sections are registered', async () => {
    mockLoadedConfig = {version: '1', harnesses: [], sources: []}
    const {runConfig} = await import('./handler')
    await runConfig({verbose: false})
    expect(rendererWarnings).toContain(M.noSections)
    expect(writtenConfig).toBeNull()
  })

  it('runs selected section editor and writes config', async () => {
    mockLoadedConfig = {
      version: '1',
      harnesses: [{id: 'cursor', enabled: true}],
      sources: [],
    }
    setSections({
      id: 'harnesses',
      label: 'Harnesses',
      hint: (cfg) => `${cfg.harnesses.length} enabled`,
      edit: async (cfg) => ({...cfg, harnesses: [...cfg.harnesses, {id: 'windsurf', enabled: true}]}),
    })
    promptResponses = {
      [M.selectSection]: 'harnesses',
    }
    const {runConfig} = await import('./handler')
    await runConfig({verbose: false})
    const cfg = writtenConfig as ProjectConfig
    expect(cfg.harnesses).toHaveLength(2)
  })

  it('loops when user picks "change another" with multiple sections', async () => {
    mockLoadedConfig = {
      version: '1',
      harnesses: [],
      sources: [],
    }
    setSections(
      {
        id: 'harnesses',
        label: 'Harnesses',
        hint: () => '0 enabled',
        edit: async (cfg) => ({...cfg, harnesses: [{id: 'cursor', enabled: true}]}),
      },
      {
        id: 'sources',
        label: 'Sources',
        hint: () => '0 configured',
        edit: async (cfg) => ({
          ...cfg,
          sources: [{name: 'default', type: 'local', path: '/tmp'} as ProjectConfig['sources'][0]],
        }),
      },
    )
    promptResponses = {
      [M.selectSection]: ['harnesses', 'sources'],
      [M.changeAnother]: [true, false],
    }
    const {runConfig} = await import('./handler')
    await runConfig({verbose: false})
    const cfg = writtenConfig as ProjectConfig
    expect(cfg.harnesses).toHaveLength(1)
    expect(cfg.sources).toHaveLength(1)
  })

  it('does not ask "change another" when only one section exists', async () => {
    mockLoadedConfig = {version: '1', harnesses: [], sources: []}
    setSections({
      id: 'harnesses',
      label: 'Harnesses',
      hint: () => '0',
      edit: async (cfg) => ({...cfg, harnesses: [{id: 'cursor', enabled: true}]}),
    })
    promptResponses = {
      [M.selectSection]: 'harnesses',
      [M.changeAnother]: true,
    }
    const {runConfig} = await import('./handler')
    await runConfig({verbose: false})
    // If it asked "change another?" and got true, it would loop forever.
    // Since there's only 1 section, it should exit after one edit.
    const cfg = writtenConfig as ProjectConfig
    expect(cfg.harnesses).toHaveLength(1)
  })
})
