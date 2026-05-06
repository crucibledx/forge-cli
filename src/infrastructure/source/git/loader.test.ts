import {existsSync} from 'node:fs'
import {mkdir, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {afterEach, beforeEach, describe, expect, it, mock, spyOn} from 'bun:test'

import {DEFAULT_SOURCE_NAME} from '../constants'
import {cleanupAllCaches, cleanupCache, GitError, gitLoader, verifyGitSource} from './loader'
import {GIT_SOURCE_MESSAGES} from './messages'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CACHE_DIR = join(tmpdir(), 'forge-cache')

function cacheKeyFor(url: string): string {
    return Buffer.from(url).toString('base64url')
}

function cacheDirFor(url: string): string {
    return join(CACHE_DIR, cacheKeyFor(url))
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

    beforeEach(async () => {
        await mkdir(dir, {recursive: true})
        await writeFile(join(dir, 'marker.txt'), 'test')
    })

    afterEach(async () => {
        await cleanupAllCaches()
    })

    it('removes the cache directory for the given url', async () => {
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
    beforeEach(async () => {
        await mkdir(join(CACHE_DIR, 'some-key'), {recursive: true})
    })

    it('removes the entire cache directory', async () => {
        expect(existsSync(CACHE_DIR)).toBe(true)
        await cleanupAllCaches()
        expect(existsSync(CACHE_DIR)).toBe(false)
    })

    it('does nothing when cache root does not exist', async () => {
        await cleanupAllCaches()
        expect(cleanupAllCaches()).resolves.toBeUndefined()
    })
})

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
            kill: () => {
            },
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
            kill: () => {
            },
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

// ─── gitLoader.configure ──────────────────────────────────────────────────────

describe('gitLoader.configure', () => {
    const mockText = mock(async (opts: {message: string, defaultValue?: string}) =>
        opts.defaultValue ?? '')

    mock.module('@infrastructure/cli/prompts', () => ({
        text: mockText,
        spinner: () => ({
            start: () => {
            }, stop: () => {
            }
        }),
        log: {
            warn: () => {
            }, success: () => {
            }, info: () => {
            }
        },
    }))

    let spawnSpy: ReturnType<typeof spyOn>

    beforeEach(() => {
        spawnSpy = spyOn(Bun, 'spawn').mockImplementation((() => ({
            exited: Promise.resolve(0),
            stdout: '',
            stderr: '',
            kill: () => {
            },
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
        const source = await gitLoader.configure() as {url: string, branch: string}
        expect(source.url).toBe('git@github.com:org/repo.git')
        expect(source.branch).toBe('develop')
    })

    it('sets path to undefined when subdirectory is empty', async () => {
        mockText.mockImplementationOnce(async () => 'git@github.com:org/repo.git')
        mockText.mockImplementationOnce(async () => 'main')
        mockText.mockImplementationOnce(async () => '')
        const source = await gitLoader.configure() as {path: string | undefined}
        expect(source.path).toBeUndefined()
    })

    it('sets path when subdirectory is provided', async () => {
        mockText.mockImplementationOnce(async () => 'git@github.com:org/repo.git')
        mockText.mockImplementationOnce(async () => 'main')
        mockText.mockImplementationOnce(async () => 'packages/ai')
        const source = await gitLoader.configure() as {path: string}
        expect(source.path).toBe('packages/ai')
    })
})

// ─── gitLoader.load ───────────────────────────────────────────────────────────

describe('gitLoader', () => {
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
            kill: () => {
            },
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
})
