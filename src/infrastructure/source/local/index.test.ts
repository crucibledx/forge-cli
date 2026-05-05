import {existsSync} from 'node:fs'
import {mkdir, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {afterEach, beforeEach, describe, expect, it} from 'bun:test'

import type {LocalSource} from '@domain/config/types'

import {LocalSourceError, localLoader} from './index'

const TMP = join(tmpdir(), '__forge_local_loader_test__')

beforeEach(async () => {
    await mkdir(TMP, {recursive: true})
})

afterEach(async () => {
    await rm(TMP, {recursive: true, force: true})
})

const makeSource = (path: string): LocalSource => ({name: 'test', type: 'local', path})

describe('localLoader', () => {
    it('has alias "local"', () => {
        expect(localLoader.alias).toBe('local')
    })

    it('has label "Local directory"', () => {
        expect(localLoader.label).toBe('Local directory')
    })

    it('returns localPath equal to the resolved path when directory exists', async () => {
        const result = await localLoader.load(makeSource(TMP))
        expect(result.localPath).toBe(TMP)
    })

    it('always returns fresh: true', async () => {
        const result = await localLoader.load(makeSource(TMP))
        expect(result.fresh).toBe(true)
    })

    it('throws LocalSourceError when path does not exist', async () => {
        const missing = join(TMP, 'does-not-exist')
        await expect(localLoader.load(makeSource(missing))).rejects.toThrow(LocalSourceError)
    })

    it('error message includes the missing path', async () => {
        const missing = join(TMP, 'no-such-dir')
        await expect(localLoader.load(makeSource(missing))).rejects.toThrow(missing)
    })

    it('resolves ~ to HOME directory', async () => {
        const home = process.env.HOME ?? ''
        const result = await localLoader.load(makeSource('~'))
        expect(result.localPath).toBe(home)
    })
})
