import {existsSync} from 'node:fs'
import {mkdir, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import type {GitSource} from '@domain/config/types'
import * as prompts from '@infrastructure/cli/prompts'

import {DEFAULT_SOURCE_NAME} from '../constants'
import type {SourceLoaderEntry} from '../types'
import {GIT_SOURCE_MESSAGES} from './messages'

const CACHE_DIR = join(tmpdir(), 'forge-cache')

export const gitLoader: SourceLoaderEntry = {
  alias: 'git',
  label: 'Git (SSH / HTTPS)',
  configure: async () => {
    const url = await prompts.text({
      message: GIT_SOURCE_MESSAGES.url.message,
      placeholder: GIT_SOURCE_MESSAGES.url.placeholder,
      validate: (val) => {
        if (!val?.trim()) return GIT_SOURCE_MESSAGES.url.required
        return undefined
      },
    })
    const branch = await prompts.text({
      message: GIT_SOURCE_MESSAGES.branch,
      placeholder: 'main',
      defaultValue: 'main',
    })
    const path = await prompts.text({
      message: GIT_SOURCE_MESSAGES.subdirectory.message,
      placeholder: GIT_SOURCE_MESSAGES.subdirectory.placeholder,
    })

    const source: GitSource = {
      name: DEFAULT_SOURCE_NAME,
      type: 'git',
      url: url.trim(),
      branch: branch?.trim() || 'main',
      path: path?.trim() || undefined,
    }

    const s = prompts.spinner()
    s.start(GIT_SOURCE_MESSAGES.verify.checking)
    const verification = await verifyGitSource(source.url, source.branch)
    if (verification.success) {
      s.stop(GIT_SOURCE_MESSAGES.verify.success)
    } else {
      s.stop(GIT_SOURCE_MESSAGES.verify.failed)
      prompts.log.warn(GIT_SOURCE_MESSAGES.verify.unreachable(verification.error ?? 'unknown error'))
    }

    return source
  },
  load: async (source) => {
    const git = source as GitSource
    const cacheKey = Buffer.from(git.url).toString('base64url')
    const cacheDir = join(CACHE_DIR, cacheKey)

    if (existsSync(join(cacheDir, '.git'))) {
      await runGit(cacheDir, ['fetch', 'origin', git.branch])
      await runGit(cacheDir, ['checkout', git.branch])
      await runGit(cacheDir, ['reset', '--hard', `origin/${git.branch}`])
      return {localPath: cacheDir, fresh: false}
    }

    await mkdir(CACHE_DIR, {recursive: true})
    await runGit(undefined, ['clone', '--branch', git.branch, '--depth', '1', git.url, cacheDir])
    return {localPath: cacheDir, fresh: true}
  },
}

export async function cleanupCache(url: string): Promise<void> {
  const cacheKey = Buffer.from(url).toString('base64url')
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

export async function verifyGitSource(url: string, branch: string): Promise<{success: boolean; error?: string}> {
  try {
    await runGit(undefined, ['ls-remote', '--exit-code', url, `refs/heads/${branch}`], {
      timeoutMs: 10_000,
      env: {GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o ConnectTimeout=5'},
    })
    return {success: true}
  } catch (err) {
    return {
      success: false,
      error: err instanceof GitError ? err.message : String(err),
    }
  }
}

async function runGit(
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
