import {existsSync} from 'node:fs'
import {mkdir, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {createFileLogger} from '@infrastructure/logger'

import type {SourceLoaderEntry} from '../types'
import type {GitSourceConfig} from './types'

const CACHE_DIR = join(tmpdir(), 'forge-cache')

export const load: SourceLoaderEntry['load'] = async (source) => {
  const logger = createFileLogger()
  const git = source as GitSourceConfig
  const cacheKey = Buffer.from(`${git.url}#${git.branch}`).toString('base64url')
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

  const localPath = git.path ? join(cacheDir, git.path) : cacheDir
  logger.debug('git source: loaded', {localPath, fresh})
  return {localPath, fresh}
}

export async function cleanupCache(url: string, branch = 'main'): Promise<void> {
  const cacheKey = Buffer.from(`${url}#${branch}`).toString('base64url')
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

  const exitCode = await proc.exited
  if (timer) clearTimeout(timer)
  const stderr = await new Response(proc.stderr).text()

  if (timedOut) {
    throw new GitError(`git ${args[0]} timed out after ${Math.round(options!.timeoutMs! / 1000)}s`)
  }

  if (exitCode !== 0) {
    throw new GitError(`git ${args[0]} failed (exit ${exitCode}): ${stderr.trim()}`)
  }

  return await new Response(proc.stdout).text()
}

export class GitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GitError'
  }
}
