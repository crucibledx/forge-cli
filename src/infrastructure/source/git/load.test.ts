import {existsSync} from 'node:fs'
import {mkdir, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {afterEach, describe, expect, it, spyOn} from 'bun:test'

import {gitLoader} from './index'
import {cleanupAllCaches, cleanupCache, GitError} from './load'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CACHE_DIR = join(tmpdir(), 'forge-cache')

function cacheKeyFor(url: string, branch = 'main'): string {
  return Buffer.from(`${url}#${branch}`).toString('base64url')
}

function cacheDirFor(url: string, branch = 'main'): string {
  return join(CACHE_DIR, cacheKeyFor(url, branch))
}

// ─── GitError ─────────────────────────────────────────────────────────────────

describe('GitError', () => {
  it('is an instance of Error', () => {
    const err = new GitError('something went wrong')
    expect(err).toBeInstanceOf(Error)
  })

  it('has name GitError', () => {
    const err = new GitError('fail')
    expect(err.name).toBe('GitError')
  })

  it('carries the message', () => {
    const err = new GitError('bad branch')
    expect(err.message).toBe('bad branch')
  })
})

// ─── cleanupCache ─────────────────────────────────────────────────────────────

describe('cleanupCache', () => {
  const TEST_URL = 'git@github.com:org/test-cleanup.git'
  const dir = cacheDirFor(TEST_URL)

  afterEach(async () => {
    await cleanupAllCaches()
  })

  it('removes the cache directory for the given url', async () => {
    await mkdir(dir, {recursive: true})
    await writeFile(join(dir, 'marker.txt'), 'test')
    expect(existsSync(dir)).toBe(true)
    await cleanupCache(TEST_URL)
    expect(existsSync(dir)).toBe(false)
  })

  it('does nothing when cache dir does not exist', async () => {
    await cleanupCache(TEST_URL)
    expect(cleanupCache(TEST_URL)).resolves.toBeUndefined()
  })
})

// ─── cleanupAllCaches ─────────────────────────────────────────────────────────

describe('cleanupAllCaches', () => {
  it('removes the entire cache directory', async () => {
    await mkdir(join(CACHE_DIR, 'some-key'), {recursive: true})
    expect(existsSync(CACHE_DIR)).toBe(true)
    await cleanupAllCaches()
    expect(existsSync(CACHE_DIR)).toBe(false)
  })

  it('does nothing when cache root does not exist', async () => {
    await cleanupAllCaches()
    expect(cleanupAllCaches()).resolves.toBeUndefined()
  })
})

// ─── load ─────────────────────────────────────────────────────────────────────

describe('load', () => {
  it('has alias "git"', () => {
    expect(gitLoader.alias).toBe('git')
  })

  it('throws GitError when git clone fails (invalid url)', async () => {
    expect(
      gitLoader.load({
        name: 'test',
        type: 'git',
        url: 'not-a-real-url',
        branch: 'main',
      }),
    ).rejects.toBeInstanceOf(GitError)
  })

  it('uses a different cache dir per url (base64url key)', async () => {
    const url1 = 'git@github.com:org/repo-a.git'
    const url2 = 'git@github.com:org/repo-b.git'
    expect(cacheKeyFor(url1)).not.toBe(cacheKeyFor(url2))
    expect(cacheDirFor(url1)).not.toBe(cacheDirFor(url2))
  })

  it('detects existing clone by .git directory and runs fetch path', async () => {
    const url = 'git@github.com:org/existing.git'
    const dir = cacheDirFor(url)

    await mkdir(join(dir, '.git'), {recursive: true})

    const spawnSpy = spyOn(Bun, 'spawn').mockImplementation((() => ({
      exited: Promise.resolve(0),
      stdout: '',
      stderr: '',
      kill: () => {},
    })) as never)

    try {
      const result = await gitLoader.load({name: 'test', type: 'git', url, branch: 'main'})
      expect(result.fresh).toBe(false)
      expect(result.localPath).toBe(dir)
      const calls = spawnSpy.mock.calls.map((c) => (c[0] as string[]).join(' '))
      expect(calls.some((c) => c.includes('fetch'))).toBe(true)
    } finally {
      spawnSpy.mockRestore()
      await cleanupCache(url)
    }
  })

  it('resolves localPath to subdir when source.path is set', async () => {
    const url = 'git@github.com:org/with-path.git'
    const dir = cacheDirFor(url)

    await mkdir(join(dir, '.git'), {recursive: true})

    const spawnSpy = spyOn(Bun, 'spawn').mockImplementation((() => ({
      exited: Promise.resolve(0),
      stdout: '',
      stderr: '',
      kill: () => {},
    })) as never)

    try {
      const result = await gitLoader.load({name: 'test', type: 'git', url, branch: 'main', path: 'packages/ai'})
      expect(result.localPath).toBe(join(dir, 'packages/ai'))
    } finally {
      spawnSpy.mockRestore()
      await cleanupCache(url)
    }
  })
})
