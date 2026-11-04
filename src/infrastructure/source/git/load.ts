import {existsSync} from 'node:fs'
import {mkdir, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {redact} from '@domain/redact'
import {hashContent} from '@domain/sync/state'
import {createFileLogger} from '@infrastructure/logger'

import {createConfinement} from '../../fs/confinement'
import type {SourceLoaderEntry} from '../types'
import type {GitSourceConfig} from './types'

const CACHE_DIR = join(tmpdir(), 'forge-cache')

export const load: SourceLoaderEntry['load'] = async (source) => {
  const logger = createFileLogger()
  const git = source as GitSourceConfig
  const cacheKey = hashContent(`${git.url}#${git.branch}`)
  const cacheDir = join(CACHE_DIR, cacheKey)

  let fresh: boolean
  if (existsSync(join(cacheDir, '.git'))) {
    logger.debug('git source: fetching updates', {url: git.url, branch: git.branch})
    await runGit(cacheDir, ['fetch', 'origin', git.branch])
    await runGit(cacheDir, ['checkout', git.branch])
    await runGit(cacheDir, ['reset', '--hard', `origin/${git.branch}`])
    fresh = false
  } else {
    logger.debug('git source: cloning', {url: git.url, branch: git.branch})
    await mkdir(CACHE_DIR, {recursive: true})
    await runGit(undefined, ['clone', '--branch', git.branch, '--depth', '1', git.url, cacheDir])
    fresh = true
  }

  const localPath =
    git.path && git.path !== '.' ? await (await createConfinement(cacheDir)).resolve(git.path) : cacheDir
  logger.debug('git source: loaded', {localPath, fresh})
  return {localPath, fresh}
}

export async function cleanupCache(url: string, branch = 'main'): Promise<void> {
  const cacheKey = hashContent(`${url}#${branch}`)
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
