import {existsSync} from 'node:fs'
import {mkdir, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {redact} from '@domain/redact'
import {hashContent} from '@domain/sync/state'
import {createFileLogger} from '@infrastructure/logger'

import {createConfinement} from '../../fs/confinement'
import type {SourceLoaderEntry} from '../types'
import {GIT_SOURCE_MESSAGES} from './messages'
import {isOptionLike} from './schema.types'
import type {GitSourceConfig} from './types'

const CACHE_DIR = join(tmpdir(), 'forge-cache')
const FETCHED_REF = 'refs/forge/fetched'
const acquisitions = new Map<string, Promise<unknown>>()

export const gitCacheKey = (source: GitSourceConfig) => hashContent(`${source.url}#${source.branch}`)

/** Hold the shared checkout through enumeration, not merely through clone/fetch. */
export async function withGitCache<T>(source: GitSourceConfig, acquire: () => Promise<T>): Promise<T> {
  const key = gitCacheKey(source)
  const previous = acquisitions.get(key) ?? Promise.resolve()
  const current = previous.catch(() => {}).then(acquire)
  acquisitions.set(key, current)
  try {
    return await current
  } finally {
    if (acquisitions.get(key) === current) acquisitions.delete(key)
  }
}

/** Checked before every git call: sources also arrive from prompts and callers that never ran the config schema. */
export function assertGitArguments(url: string, branch: string): void {
  if (isOptionLike(url)) throw new GitError(GIT_SOURCE_MESSAGES.optionLike('url'))
  if (isOptionLike(branch)) throw new GitError(GIT_SOURCE_MESSAGES.optionLike('branch'))
}

const COMMIT_SHA = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i

/**
 * Qualify a configured ref the way `clone --branch` does: branch first, then tag. A bare fetch refspec would prefer a
 * same-named tag. A full commit SHA is returned as is, because ls-remote lists refs, never commits.
 */
export async function resolveRemoteRef(
  url: string,
  name: string,
  options?: {timeoutMs?: number; env?: Record<string, string>},
): Promise<string> {
  const candidates = [`refs/heads/${name}`, `refs/tags/${name}`]
  const listed = new Set(
    (await runGit(undefined, ['ls-remote', '--', url, ...candidates], options))
      .split('\n')
      .map((line) => line.split('\t')[1]),
  )
  const ref = candidates.find((candidate) => listed.has(candidate))
  if (ref) return ref
  if (COMMIT_SHA.test(name)) return name
  throw new GitError(GIT_SOURCE_MESSAGES.refNotFound(name))
}

export const load: SourceLoaderEntry['load'] = async (source) => {
  const logger = createFileLogger()
  const git = source as GitSourceConfig
  assertGitArguments(git.url, git.branch)
  const cacheKey = gitCacheKey(git)
  const cacheDir = join(CACHE_DIR, cacheKey)

  const ref = await resolveRemoteRef(git.url, git.branch)
  const pinned = !ref.startsWith('refs/')
  const fresh = !existsSync(join(cacheDir, '.git'))
  logger.debug(fresh ? 'git source: cloning' : 'git source: fetching updates', {url: git.url, branch: git.branch, ref})
  try {
    if (fresh && !pinned) {
      await mkdir(CACHE_DIR, {recursive: true})
      // clone takes the remote's object format and, like resolveRemoteRef, prefers a branch over a same-named tag.
      await runGit(undefined, ['clone', '--branch', git.branch, '--depth', '1', '--', git.url, cacheDir])
    } else {
      if (fresh) {
        // `clone --branch` rejects a commit SHA. An empty repository cannot learn the remote's object format the
        // way clone does, but the SHA's length gives it.
        await mkdir(cacheDir, {recursive: true})
        await runGit(cacheDir, ['init', '--quiet', `--object-format=${ref.length === 64 ? 'sha256' : 'sha1'}`])
        await runGit(cacheDir, ['remote', 'add', '--', 'origin', git.url])
      }
      // A tag or SHA has no origin/<ref> remote-tracking ref, and FETCH_HEAD is skipped under
      // fetch.writeFetchHEAD=false, so fetch the resolved ref into a private ref and check that out detached.
      await runGit(cacheDir, ['fetch', '--depth', '1', '--', 'origin', `+${ref}:${FETCHED_REF}`])
      await runGit(cacheDir, ['checkout', '--quiet', '--force', '--detach', FETCHED_REF])
    }
  } catch (error) {
    // A half-initialised cache would otherwise be taken for a warm one on the next sync.
    if (fresh) await rm(cacheDir, {recursive: true, force: true})
    throw error
  }

  // Only dot-directory components select the root; never normalize away parent traversal.
  const rootSelected = !git.path || /^\.(?:[/\\]+\.)*[/\\]*$/.test(git.path)
  const localPath = rootSelected ? cacheDir : await (await createConfinement(cacheDir)).resolve(git.path!)
  logger.debug('git source: loaded', {localPath, fresh})
  return {localPath, fresh}
}

export async function cleanupCache(url: string, branch = 'main'): Promise<void> {
  const cacheKey = gitCacheKey({name: '', type: 'git', url, branch})
  const cacheDir = join(CACHE_DIR, cacheKey)
  if (existsSync(cacheDir)) {
    await rm(cacheDir, {recursive: true, force: true})
  }
}

export async function cleanupAllCaches(): Promise<void> {
  if (existsSync(CACHE_DIR)) {
    await rm(CACHE_DIR, {recursive: true, force: true})
  }
}

export async function runGit(
  cwd: string | undefined,
  args: string[],
  options?: {timeoutMs?: number; env?: Record<string, string>},
): Promise<string> {
  const proc = Bun.spawn(['git', ...args], {
    cwd: cwd ?? undefined,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {...process.env, GIT_TERMINAL_PROMPT: '0', ...options?.env},
  })

  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | undefined
  if (options?.timeoutMs) {
    timer = setTimeout(() => {
      timedOut = true
      proc.kill()
    }, options.timeoutMs)
  }

  const streams = Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  const exitCode = await proc.exited
  if (timer) clearTimeout(timer)
  const [stdout, stderr] = await streams

  if (timedOut) {
    throw new GitError(`git ${args[0]} timed out after ${Math.round(options!.timeoutMs! / 1000)}s`)
  }

  if (exitCode !== 0) {
    throw new GitError(redact(`git ${args[0]} failed (exit ${exitCode}): ${stderr.trim()}`))
  }

  return stdout
}

export class GitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GitError'
  }
}
