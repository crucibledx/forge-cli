import {existsSync} from 'node:fs'
import {mkdir, readFile} from 'node:fs/promises'
import {join} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {describe, expect, it} from 'bun:test'

import {applyMutations, PathTraversalError, safeResolve} from './mutations'

const getDir = useTmpDir('mutations')

describe('applyMutations', () => {
  it('returns empty array for no mutations', async () => {
    const result = await applyMutations(getDir(), [])
    expect(result).toEqual([])
  })

  describe('dir_create', () => {
    it('creates a directory', async () => {
      const dir = getDir()
      const result = await applyMutations(dir, [{type: 'dir_create', path: 'new-dir'}])
      expect(result[0].success).toBe(true)
      expect(existsSync(join(dir, 'new-dir'))).toBe(true)
    })

    it('is idempotent — succeeds if directory already exists', async () => {
      const dir = getDir()
      await mkdir(join(dir, 'existing-dir'), {recursive: true})
      const result = await applyMutations(dir, [{type: 'dir_create', path: 'existing-dir'}])
      expect(result[0].success).toBe(true)
    })
  })

  describe('file_write', () => {
    it('creates a new file with content', async () => {
      const dir = getDir()
      const result = await applyMutations(dir, [{type: 'file_write', path: 'skills/ts.md', content: '# TS'}])
      expect(result[0].success).toBe(true)
      expect(result[0].previousContent).toBeUndefined()
      const content = await readFile(join(dir, 'skills/ts.md'), 'utf-8')
      expect(content).toBe('# TS')
    })

    it('stores previousContent when overwriting existing file', async () => {
      const dir = getDir()
      await mkdir(join(dir, 'skills'), {recursive: true})
      await Bun.write(join(dir, 'skills/ts.md'), 'old content')

      const result = await applyMutations(dir, [{type: 'file_write', path: 'skills/ts.md', content: 'new content'}])
      expect(result[0].success).toBe(true)
      expect(result[0].previousContent).toBe('old content')
    })

    it('creates intermediate directories', async () => {
      const dir = getDir()
      const result = await applyMutations(dir, [{type: 'file_write', path: 'a/b/c/file.md', content: 'deep'}])
      expect(result[0].success).toBe(true)
      expect(existsSync(join(dir, 'a/b/c/file.md'))).toBe(true)
    })
  })

  describe('file_delete', () => {
    it('deletes an existing file and captures previous content', async () => {
      const dir = getDir()
      await Bun.write(join(dir, 'to-delete.md'), 'bye')
      const result = await applyMutations(dir, [{type: 'file_delete', path: 'to-delete.md'}])
      expect(result[0].success).toBe(true)
      expect(result[0].previousContent).toBe('bye')
      expect(existsSync(join(dir, 'to-delete.md'))).toBe(false)
    })

    it('succeeds silently when file does not exist', async () => {
      const result = await applyMutations(getDir(), [{type: 'file_delete', path: 'ghost.md'}])
      expect(result[0].success).toBe(true)
      expect(result[0].previousContent).toBeUndefined()
    })
  })

  describe('symlink_create', () => {
    it('creates a symlink', async () => {
      const dir = getDir()
      await Bun.write(join(dir, 'source.md'), 'content')
      const result = await applyMutations(dir, [
        {type: 'symlink_create', path: 'link.md', target: join(dir, 'source.md')},
      ])
      expect(result[0].success).toBe(true)
      expect(existsSync(join(dir, 'link.md'))).toBe(true)
    })
  })

  describe('stop on first error', () => {
    it('stops processing after a failed mutation', async () => {
      const dir = getDir()
      await Bun.write(join(dir, 'source.md'), 'content')
      const first = {type: 'symlink_create' as const, path: 'link.md', target: join(dir, 'source.md')}
      // First create succeeds
      await applyMutations(dir, [first])
      // Second run — symlink already exists, should fail and stop
      const result = await applyMutations(dir, [
        {type: 'symlink_create' as const, path: 'link.md', target: join(dir, 'source.md')},
        {type: 'file_write' as const, path: 'should-not-be-created.md', content: 'x'},
      ])
      expect(result[0].success).toBe(false)
      expect(result).toHaveLength(1)
    })
  })

  describe('path traversal protection', () => {
    it('rejects ../escape paths in file_write', async () => {
      const dir = getDir()
      const result = await applyMutations(dir, [{type: 'file_write', path: '../../../etc/passwd', content: 'pwned'}])
      expect(result[0].success).toBe(false)
      expect(result[0].error).toContain('resolves outside project root')
    })

    it('rejects ../escape paths in file_delete', async () => {
      const dir = getDir()
      const result = await applyMutations(dir, [{type: 'file_delete', path: '../../escape'}])
      expect(result[0].success).toBe(false)
      expect(result[0].error).toContain('resolves outside project root')
    })

    it('rejects ../escape paths in dir_create', async () => {
      const dir = getDir()
      const result = await applyMutations(dir, [{type: 'dir_create', path: '../../../tmp/evil'}])
      expect(result[0].success).toBe(false)
      expect(result[0].error).toContain('resolves outside project root')
    })

    it('allows valid nested paths', async () => {
      const dir = getDir()
      const result = await applyMutations(dir, [{type: 'file_write', path: 'a/b/../b/file.md', content: 'ok'}])
      expect(result[0].success).toBe(true)
    })
  })
})

describe('safeResolve', () => {
  it('resolves relative paths inside project root', () => {
    const result = safeResolve('/project', 'skills/ts.md')
    expect(result).toBe('/project/skills/ts.md')
  })

  it('throws PathTraversalError for paths escaping root', () => {
    expect(() => safeResolve('/project', '../etc/passwd')).toThrow(PathTraversalError)
  })

  it('throws for absolute paths outside root', () => {
    expect(() => safeResolve('/project', '/etc/passwd')).toThrow(PathTraversalError)
  })

  it('allows absolute paths inside root', () => {
    const result = safeResolve('/project', '/project/skills/ts.md')
    expect(result).toBe('/project/skills/ts.md')
  })
})
