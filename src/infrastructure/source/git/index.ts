import {existsSync} from 'node:fs'
import {mkdir, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import type {GitSource} from '@domain/config/types'

import type {SourceLoaderEntry} from '../types'

const CACHE_DIR = join(tmpdir(), 'forge-cache')

export const gitLoader: SourceLoaderEntry = {
    alias: 'git',
    label: 'Git (SSH / HTTPS)',
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

async function runGit(cwd: string | undefined, args: string[]): Promise<string> {
    const proc = Bun.spawn(['git', ...args], {
        cwd: cwd ?? undefined,
        stdout: 'pipe',
        stderr: 'pipe',
    })

    const exitCode = await proc.exited
    const stderr = await new Response(proc.stderr).text()

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
