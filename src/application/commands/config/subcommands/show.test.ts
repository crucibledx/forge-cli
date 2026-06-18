import {beforeEach, describe, expect, it, mock, spyOn} from 'bun:test'

import type {ProjectConfig} from '@domain/config/types'
import {SYNC_CONFIG_DEFAULTS} from '@domain/config/types'

import {runConfigShow, SHOW_MESSAGES} from './show'

const mockLoadProjectConfig = mock<() => ProjectConfig | null>()
const mockResolveProjectRoot = mock<() => string>()

mock.module('@infrastructure/config', () => ({
  loadProjectConfig: (..._args: unknown[]) => mockLoadProjectConfig(),
}))
mock.module('@infrastructure/io', () => ({
  default: {resolveProjectRoot: () => mockResolveProjectRoot()},
}))
mock.module('@infrastructure/cli/renderer', () => ({
  renderHeader: mock(),
  renderWarning: mock(),
  renderNewline: mock(),
}))

const consoleLogSpy = spyOn(console, 'log')

const baseConfig: ProjectConfig = {
  version: '1',
  assistants: [{id: 'cursor', enabled: true}],
  sources: [
    {
      name: 'default',
      type: 'git',
      url: 'git@github.com:org/repo.git',
      branch: 'main',
    },
  ],
}

describe('runConfigShow', () => {
  beforeEach(() => {
    mockResolveProjectRoot.mockReturnValue('/test')
    consoleLogSpy.mockReset()
  })

  it('warns when no config found', async () => {
    mockLoadProjectConfig.mockReturnValue(null)
    const {renderWarning} = await import('@infrastructure/cli/renderer')
    await runConfigShow()
    expect(renderWarning).toHaveBeenCalledWith(SHOW_MESSAGES.noConfig)
  })

  it('prints assistants section', async () => {
    mockLoadProjectConfig.mockReturnValue(baseConfig)
    await runConfigShow()
    const output = consoleLogSpy.mock.calls.map((c) => c[0]).join('\n')
    expect(output).toContain('Assistants')
    expect(output).toContain('Cursor')
  })

  it('prints sources section with type-specific fields', async () => {
    mockLoadProjectConfig.mockReturnValue(baseConfig)
    await runConfigShow()
    const output = consoleLogSpy.mock.calls.map((c) => c[0]).join('\n')
    expect(output).toContain('Sources')
    expect(output).toContain('default')
    expect(output).toContain('git@github.com:org/repo.git')
  })

  it('prints sync defaults', async () => {
    mockLoadProjectConfig.mockReturnValue(baseConfig)
    await runConfigShow()
    const output = consoleLogSpy.mock.calls.map((c) => c[0]).join('\n')
    expect(output).toContain('Sync Settings')
    expect(output).toContain(SYNC_CONFIG_DEFAULTS.source_conflict_strategy)
    expect(output).toContain(SYNC_CONFIG_DEFAULTS.local_conflict_strategy)
  })

  it('prints non-default sync values without (default) marker', async () => {
    mockLoadProjectConfig.mockReturnValue({
      ...baseConfig,
      sync: {source_conflict_strategy: 'error', local_conflict_strategy: 'local-wins'},
    })
    await runConfigShow()
    const output = consoleLogSpy.mock.calls.map((c) => c[0]).join('\n')
    expect(output).toContain('error')
    expect(output).toContain('local-wins')
  })

  it('prints schedule when configured', async () => {
    mockLoadProjectConfig.mockReturnValue({
      ...baseConfig,
      sync: {schedule: '0 9 * * *'},
    })
    await runConfigShow()
    const output = consoleLogSpy.mock.calls.map((c) => c[0]).join('\n')
    expect(output).toContain('Schedule')
    expect(output).toContain('0 9 * * *')
  })

  it('shows none for empty assistants', async () => {
    mockLoadProjectConfig.mockReturnValue({...baseConfig, assistants: []})
    await runConfigShow()
    const output = consoleLogSpy.mock.calls.map((c) => c[0]).join('\n')
    expect(output).toContain('none')
  })

  it('shows advanced source options when set', async () => {
    mockLoadProjectConfig.mockReturnValue({
      ...baseConfig,
      sources: [
        {
          name: 'filtered',
          type: 'git',
          url: 'git@github.com:org/repo.git',
          branch: 'main',
          layout: 'canonical',
          include: ['skills/**'],
          exclude: ['draft-*'],
          map: 'team',
        },
      ],
    })
    await runConfigShow()
    const output = consoleLogSpy.mock.calls.map((c) => c[0]).join('\n')
    expect(output).toContain('canonical')
    expect(output).toContain('skills/**')
    expect(output).toContain('draft-*')
    expect(output).toContain('team')
  })
})
