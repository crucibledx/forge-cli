import {existsSync} from 'node:fs'
import {mkdir, readFile} from 'node:fs/promises'
import {join} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {describe, expect, it} from 'bun:test'

import type {AppliedMutation} from './mutations'
import {rollbackMutations} from './rollback'

const getDir = useTmpDir('rollback')

describe('rollbackMutations', () => {
    it('does nothing for empty list', async () => {
        await rollbackMutations(getDir(), [])
    })

    it('skips failed mutations (only rolls back successful ones)', async () => {
        const dir = getDir()
        const applied: AppliedMutation[] = [
            {mutation: {type: 'file_write', path: 'file.md', content: 'x'}, success: false, error: 'something went wrong'},
        ]
        await rollbackMutations(dir, applied)
        expect(existsSync(join(dir, 'file.md'))).toBe(false)
    })

    it('deletes a newly-written file (no previousContent) on rollback', async () => {
        const dir = getDir()
        await Bun.write(join(dir, 'new.md'), 'fresh content')
        const applied: AppliedMutation[] = [
            {mutation: {type: 'file_write', path: 'new.md', content: 'fresh content'}, success: true, previousContent: undefined},
        ]
        await rollbackMutations(dir, applied)
        expect(existsSync(join(dir, 'new.md'))).toBe(false)
    })

    it('restores previous content on rollback of file_write', async () => {
        const dir = getDir()
        await Bun.write(join(dir, 'existing.md'), 'new content')
        const applied: AppliedMutation[] = [
            {mutation: {type: 'file_write', path: 'existing.md', content: 'new content'}, success: true, previousContent: 'original content'},
        ]
        await rollbackMutations(dir, applied)
        expect(await readFile(join(dir, 'existing.md'), 'utf-8')).toBe('original content')
    })

    it('restores a deleted file on rollback of file_delete', async () => {
        const dir = getDir()
        const applied: AppliedMutation[] = [
            {mutation: {type: 'file_delete', path: 'deleted.md'}, success: true, previousContent: 'was here'},
        ]
        await rollbackMutations(dir, applied)
        expect(existsSync(join(dir, 'deleted.md'))).toBe(true)
        expect(await readFile(join(dir, 'deleted.md'), 'utf-8')).toBe('was here')
    })

    it('removes an empty created dir on rollback of dir_create', async () => {
        const dir = getDir()
        const emptyDir = join(dir, 'empty-dir')
        await mkdir(emptyDir, {recursive: true})
        const applied: AppliedMutation[] = [
            {mutation: {type: 'dir_create', path: 'empty-dir'}, success: true},
        ]
        await rollbackMutations(dir, applied)
        expect(existsSync(emptyDir)).toBe(false)
    })

    it('removes a symlink on rollback of symlink_create', async () => {
        const dir = getDir()
        const {symlink} = await import('node:fs/promises')
        await Bun.write(join(dir, 'source.md'), 'content')
        await symlink(join(dir, 'source.md'), join(dir, 'link.md'))
        const applied: AppliedMutation[] = [
            {mutation: {type: 'symlink_create', path: 'link.md', target: join(dir, 'source.md')}, success: true},
        ]
        await rollbackMutations(dir, applied)
        expect(existsSync(join(dir, 'link.md'))).toBe(false)
    })

    it('rolls back in reverse order', async () => {
        const dir = getDir()
        const applied: AppliedMutation[] = [
            {mutation: {type: 'file_write', path: 'a.md', content: 'a'}, success: true},
            {mutation: {type: 'file_write', path: 'b.md', content: 'b'}, success: true},
        ]
        await Bun.write(join(dir, 'a.md'), 'a')
        await Bun.write(join(dir, 'b.md'), 'b')
        await rollbackMutations(dir, applied)
        expect(existsSync(join(dir, 'a.md'))).toBe(false)
        expect(existsSync(join(dir, 'b.md'))).toBe(false)
    })
})
