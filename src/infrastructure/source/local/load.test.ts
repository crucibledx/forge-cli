import {mkdir, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {afterEach, beforeEach, describe, expect, it} from 'bun:test'

import {localLoader} from './index'
import {LocalSourceError} from './load'
import type {LocalSourceConfig} from './types'

const TMP = join(tmpdir(), '__forge_local_load_test__')

beforeEach(async () => {
  await mkdir(TMP, {recursive: true})
})

afterEach(async () => {
  await rm(TMP, {recursive: true, force: true})
})

const makeSource = (path: string): LocalSourceConfig => ({name: 'test', type: 'local', path})

// ─── load ─────────────────────────────────────────────────────────────────────

describe('load', () => {
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
    expect(localLoader.load(makeSource(missing))).rejects.toThrow(LocalSourceError)
  })

  it('error message includes the missing path', async () => {
    const missing = join(TMP, 'no-such-dir')
    expect(localLoader.load(makeSource(missing))).rejects.toThrow(missing)
  })

  it('resolves ~ to HOME directory', async () => {
    const home = process.env.HOME ?? ''
    const result = await localLoader.load(makeSource('~'))
    expect(result.localPath).toBe(home)
  })
})
