import {mkdir, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

import {afterEach, beforeEach, describe, expect, it, mock} from 'bun:test'

import {DEFAULT_SOURCE_NAME} from '../constants'
import {validateLocalPath} from './configure'
import {localLoader} from './index'
import {LOCAL_SOURCE_MESSAGES} from './messages'
import type {LocalSourceConfig} from './types'

const TMP = join(tmpdir(), '__forge_local_configure_test__')

beforeEach(async () => {
  await mkdir(TMP, {recursive: true})
})

afterEach(async () => {
  await rm(TMP, {recursive: true, force: true})
})

// ─── validateLocalPath ────────────────────────────────────────────────────────

describe('validateLocalPath', () => {
  it('returns required message for empty input', () => {
    expect(validateLocalPath('')).toBe(LOCAL_SOURCE_MESSAGES.path.required)
    expect(validateLocalPath(undefined)).toBe(LOCAL_SOURCE_MESSAGES.path.required)
    expect(validateLocalPath('   ')).toBe(LOCAL_SOURCE_MESSAGES.path.required)
  })

  it('returns undefined for an existing directory', () => {
    expect(validateLocalPath(TMP)).toBeUndefined()
  })

  it('returns notFound for a non-existent path', () => {
    expect(validateLocalPath(join(TMP, 'does-not-exist'))).toBe(LOCAL_SOURCE_MESSAGES.path.notFound)
  })

  it('returns notDirectory when path is a file', async () => {
    const file = join(TMP, 'some.txt')
    await Bun.write(file, 'content')
    expect(validateLocalPath(file)).toBe(LOCAL_SOURCE_MESSAGES.path.notDirectory)
  })

  it('expands ~ to home directory', () => {
    expect(validateLocalPath('~')).toBeUndefined()
  })
})

// ─── LOCAL_SOURCE_MESSAGES ────────────────────────────────────────────────────

describe('LOCAL_SOURCE_MESSAGES', () => {
  it('exposes path.message', () => {
    expect(typeof LOCAL_SOURCE_MESSAGES.path.message).toBe('string')
  })

  it('exposes path.required', () => {
    expect(typeof LOCAL_SOURCE_MESSAGES.path.required).toBe('string')
  })
})

// ─── configure ───────────────────────────────────────────────────────────────

describe('configure', () => {
  const mockText = mock(async (_opts: {message: string}) => TMP)

  mock.module('@infrastructure/cli/prompts', () => ({
    text: mockText,
  }))

  it('returns a LocalSource with type local', async () => {
    mockText.mockImplementationOnce(async () => TMP)
    const source = await localLoader.configure()
    expect(source.type).toBe('local')
  })

  it('uses DEFAULT_SOURCE_NAME as source name', async () => {
    mockText.mockImplementationOnce(async () => TMP)
    const source = await localLoader.configure()
    expect(source.name).toBe(DEFAULT_SOURCE_NAME)
  })

  it('trims the path', async () => {
    mockText.mockImplementationOnce(async () => `  ${TMP}  `)
    const source = (await localLoader.configure()) as LocalSourceConfig
    expect(source.path).toBe(TMP)
  })
})
