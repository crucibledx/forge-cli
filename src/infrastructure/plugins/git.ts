import {randomUUID} from 'node:crypto'
import {existsSync} from 'node:fs'
import {mkdir, mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import type {PluginFile} from '@domain/plugins'
import {hashContent} from '@domain/sync/state'

import {absoluteRemoteUrl, objectFormatOf, runGit} from '../source/git/load'
import {readPluginFiles} from './files'

const FULL_SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i

const cacheDir = (url: string) => join(tmpdir(), 'forge-cache', 'plugins', hashContent(url))
const pending = new Map<string, Promise<unknown>>()

async function serialized<T>(key: string, run: () => Promise<T>): Promise<T> {
  const current = (pending.get(key) ?? Promise.resolve()).catch(() => {}).then(run)
  pending.set(key, current)
  try {
    return await current
  } finally {
    if (pending.get(key) === current) pending.delete(key)
  }
}

async function hasCommit(bare: string, sha: string): Promise<boolean> {
  return runGit(bare, ['cat-file', '-e', `${sha}^{commit}`]).then(
    () => true,
    () => false,
  )
}

/**
 * Resolve `ref` (branch, tag or SHA) to a commit, or make the `locked` commit available, in a bare cache per URL.
 * A commit already in the cache needs no network.
 */
export async function resolveGitCommit(
  url: string,
  ref: string,
  locked?: string,
): Promise<{bare: string; sha: string}> {
  // Fetches run inside the cache, so a relative path must be resolved against the caller's working directory first.
  const remote = absoluteRemoteUrl(url)
  const bare = cacheDir(remote)
  return serialized(bare, () => resolveInCache(bare, remote, ref, locked))
}

/**
 * An empty repository cannot learn the remote's object format the way clone does: a commit SHA's length gives it, and
 * for a branch or tag the SHA the remote advertises for it. A ref the remote lacks falls back to sha1 and fails in fetch.
 */
async function remoteObjectFormat(url: string, ref: string, want?: string): Promise<string> {
  return objectFormatOf(want ?? (await runGit(undefined, ['ls-remote', '--', url, ref])).split('\t')[0].trim())
}

async function resolveInCache(bare: string, url: string, ref: string, locked?: string) {
  const want = locked ?? (FULL_SHA.test(ref) ? ref.toLowerCase() : undefined)
  const fresh = !existsSync(join(bare, 'HEAD'))
  if (fresh) {
    const format = await remoteObjectFormat(url, ref, want)
    await mkdir(bare, {recursive: true})
    await runGit(bare, ['init', '--bare', '--quiet', `--object-format=${format}`])
  }
  try {
    return await fetchCommit(bare, url, ref, want)
  } catch (error) {
    // A cache initialised in the wrong format, or holding no commit, would otherwise be taken for a warm one next time.
    if (fresh) await rm(bare, {recursive: true, force: true})
    throw error
  }
}

async function fetchCommit(bare: string, url: string, ref: string, want?: string) {
  if (want) {
    if (!(await hasCommit(bare, want))) await runGit(bare, ['fetch', '--quiet', '--depth', '1', url, want])
    return {bare, sha: want}
  }
  // A private ref per call: another process resolving the same URL must not overwrite it before rev-parse.
  const target = `refs/forge/resolve-${randomUUID()}`
  try {
    await runGit(bare, ['fetch', '--quiet', '--depth', '1', url, `+${ref}:${target}`])
    return {bare, sha: (await runGit(bare, ['rev-parse', `${target}^{commit}`])).trim()}
  } finally {
    await runGit(bare, ['update-ref', '-d', target]).catch(() => {})
  }
}

/** Package files at `sha`, checked out into a throwaway tree with a private index. */
export async function readGitPlugin(bare: string, sha: string, path?: string): Promise<PluginFile[]> {
  const work = await mkdtemp(join(tmpdir(), 'forge-plugin-'))
  try {
    const tree = join(work, 'tree')
    await mkdir(tree)
    await runGit(
      undefined,
      ['--git-dir', bare, '--work-tree', tree, 'checkout', '--quiet', '-f', sha, '--', path ?? '.'],
      {
        env: {GIT_INDEX_FILE: join(work, 'index')},
      },
    )
    return await readPluginFiles(path ? join(tree, path) : tree, tree)
  } finally {
    await rm(work, {recursive: true, force: true})
  }
}
