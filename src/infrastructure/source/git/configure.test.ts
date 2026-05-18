import {afterEach, beforeEach, describe, expect, it, mock, spyOn} from 'bun:test'

import {DEFAULT_SOURCE_NAME} from '../constants'
import {verifyGitSource} from './configure'
import {gitLoader} from './index'
import {GIT_SOURCE_MESSAGES} from './messages'
import type {GitSourceConfig} from './types'

// ─── GIT_SOURCE_MESSAGES ──────────────────────────────────────────────────────

describe('GIT_SOURCE_MESSAGES', () => {
  it('exposes url.message', () => {
    expect(typeof GIT_SOURCE_MESSAGES.url.message).toBe('string')
  })

  it('exposes url.required', () => {
    expect(typeof GIT_SOURCE_MESSAGES.url.required).toBe('string')
  })

  it('exposes branch', () => {
    expect(typeof GIT_SOURCE_MESSAGES.branch).toBe('string')
  })

  it('exposes subdirectory.message', () => {
    expect(typeof GIT_SOURCE_MESSAGES.subdirectory.message).toBe('string')
  })
})

// ─── verifyGitSource ──────────────────────────────────────────────────────────

describe('verifyGitSource', () => {
  it('returns success:true when ls-remote exits 0', async () => {
    const spawnSpy = spyOn(Bun, 'spawn').mockImplementation((() => ({
      exited: Promise.resolve(0),
      stdout: 'abc123\trefs/heads/main\n',
      stderr: '',
      kill: () => {},
    })) as never)
    try {
      const result = await verifyGitSource('git@github.com:org/repo.git', 'main')
      expect(result.success).toBe(true)
      expect(result.error).toBeUndefined()
    } finally {
      spawnSpy.mockRestore()
    }
  })

  it('returns success:false with error when ls-remote fails', async () => {
    const spawnSpy = spyOn(Bun, 'spawn').mockImplementation((() => ({
      exited: Promise.resolve(128),
      stdout: '',
      stderr: 'Permission denied (publickey).',
      kill: () => {},
    })) as never)
    try {
      const result = await verifyGitSource('git@github.com:org/repo.git', 'main')
      expect(result.success).toBe(false)
      expect(result.error).toContain('Permission denied')
    } finally {
      spawnSpy.mockRestore()
    }
  })
})

// ─── configure ───────────────────────────────────────────────────────────────

describe('configure', () => {
  const mockText = mock(async (opts: {message: string; defaultValue?: string}) => opts.defaultValue ?? '')

  mock.module('@infrastructure/cli/prompts', () => ({
    text: mockText,
    spinner: () => ({
      start: () => {},
      stop: () => {},
    }),
    log: {
      warn: () => {},
      success: () => {},
      info: () => {},
    },
  }))

  let spawnSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    spawnSpy = spyOn(Bun, 'spawn').mockImplementation((() => ({
      exited: Promise.resolve(0),
      stdout: '',
      stderr: '',
      kill: () => {},
    })) as never)
  })

  afterEach(() => {
    spawnSpy.mockRestore()
  })

  it('returns a GitSource with type git', async () => {
    mockText.mockImplementationOnce(async () => 'git@github.com:org/repo.git')
    mockText.mockImplementationOnce(async () => 'main')
    mockText.mockImplementationOnce(async () => '')
    const source = await gitLoader.configure()
    expect(source.type).toBe('git')
  })

  it('uses DEFAULT_SOURCE_NAME as source name', async () => {
    mockText.mockImplementationOnce(async () => 'git@github.com:org/repo.git')
    mockText.mockImplementationOnce(async () => 'main')
    mockText.mockImplementationOnce(async () => '')
    const source = await gitLoader.configure()
    expect(source.name).toBe(DEFAULT_SOURCE_NAME)
  })

  it('trims url and branch', async () => {
    mockText.mockImplementationOnce(async () => '  git@github.com:org/repo.git  ')
    mockText.mockImplementationOnce(async () => '  develop  ')
    mockText.mockImplementationOnce(async () => '')
    const source = (await gitLoader.configure()) as GitSourceConfig
    expect(source.url).toBe('git@github.com:org/repo.git')
    expect(source.branch).toBe('develop')
  })

  it('sets path to undefined when subdirectory is empty', async () => {
    mockText.mockImplementationOnce(async () => 'git@github.com:org/repo.git')
    mockText.mockImplementationOnce(async () => 'main')
    mockText.mockImplementationOnce(async () => '')
    const source = (await gitLoader.configure()) as GitSourceConfig
    expect(source.path).toBeUndefined()
  })

  it('sets path when subdirectory is provided', async () => {
    mockText.mockImplementationOnce(async () => 'git@github.com:org/repo.git')
    mockText.mockImplementationOnce(async () => 'main')
    mockText.mockImplementationOnce(async () => 'packages/ai')
    const source = (await gitLoader.configure()) as GitSourceConfig
    expect(source.path).toBe('packages/ai')
  })
})
