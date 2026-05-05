import {mkdir, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {describe, expect, it} from 'bun:test'

import {collectFiles} from './reader'

const getDir = useTmpDir('reader')

describe('collectFiles', () => {
    it('returns empty array for non-existent directory', async () => {
        const result = await collectFiles(join(getDir(), 'does-not-exist'))
        expect(result).toEqual([])
    })

    it('returns empty array for empty directory', async () => {
        const result = await collectFiles(getDir())
        expect(result).toEqual([])
    })

    it('collects a single file with correct content and relative path', async () => {
        const dir = getDir()
        await writeFile(join(dir, 'hello.md'), '# Hello', 'utf-8')
        const result = await collectFiles(dir)
        expect(result).toHaveLength(1)
        expect(result[0].relativePath).toBe('hello.md')
        expect(result[0].content).toBe('# Hello')
    })

    it('collects files recursively', async () => {
        const dir = getDir()
        await mkdir(join(dir, 'skills'), {recursive: true})
        await writeFile(join(dir, 'skills', 'ts.md'), '# TS', 'utf-8')
        await writeFile(join(dir, 'root.md'), '# Root', 'utf-8')

        const result = await collectFiles(dir)
        const paths = result.map((f) => f.relativePath)
        expect(paths).toContain('root.md')
        expect(paths).toContain('skills/ts.md')
    })

    it('skips dotfiles and dot-directories', async () => {
        const dir = getDir()
        await writeFile(join(dir, '.hidden'), 'secret', 'utf-8')
        await mkdir(join(dir, '.git'), {recursive: true})
        await writeFile(join(dir, '.git', 'HEAD'), 'ref: refs/heads/main', 'utf-8')
        await writeFile(join(dir, 'visible.md'), 'visible', 'utf-8')

        const result = await collectFiles(dir)
        const paths = result.map((f) => f.relativePath)
        expect(paths).not.toContain('.hidden')
        expect(paths).not.toContain('.git/HEAD')
        expect(paths).toContain('visible.md')
    })

    it('handles nested subdirectories', async () => {
        const dir = getDir()
        await mkdir(join(dir, 'a', 'b', 'c'), {recursive: true})
        await writeFile(join(dir, 'a', 'b', 'c', 'deep.txt'), 'deep', 'utf-8')

        const result = await collectFiles(dir)
        expect(result[0].relativePath).toBe('a/b/c/deep.txt')
        expect(result[0].content).toBe('deep')
    })
})
