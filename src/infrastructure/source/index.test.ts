import {describe, expect, it} from 'bun:test'

import {getSourceLoader, getSourceLoaderOptions} from './index'

describe('getSourceLoader', () => {
  it('returns git loader with correct alias', () => {
    expect(getSourceLoader('git').alias).toBe('git')
  })

  it('returns git loader with correct label', () => {
    expect(getSourceLoader('git').label).toBe('Git (SSH / HTTPS)')
  })

  it('returns local loader with correct alias', () => {
    expect(getSourceLoader('local').alias).toBe('local')
  })

  it('returns local loader with correct label', () => {
    expect(getSourceLoader('local').label).toBe('Local directory')
  })

  it('each loader has a load function', () => {
    expect(typeof getSourceLoader('git').load).toBe('function')
    expect(typeof getSourceLoader('local').load).toBe('function')
  })

  it('throws for unknown source type', () => {
    expect(() => getSourceLoader('ftp')).toThrow('Unsupported source type: "ftp"')
  })

  it('error message lists all available types', () => {
    expect(() => getSourceLoader('s3')).toThrow('Available: git, local')
  })
})

describe('getSourceLoaderOptions', () => {
  it('returns an array of {value, label} entries', () => {
    const opts = getSourceLoaderOptions()
    expect(Array.isArray(opts)).toBe(true)
    expect(opts.length).toBeGreaterThan(0)
    for (const opt of opts) {
      expect(typeof opt.value).toBe('string')
      expect(typeof opt.label).toBe('string')
    }
  })

  it('includes git and local options', () => {
    const opts = getSourceLoaderOptions()
    const values = opts.map((o) => o.value)
    expect(values).toContain('git')
    expect(values).toContain('local')
  })
})
