import {describe, expect, it} from 'bun:test'

import {PathTraversalError, safeResolve} from './mutations'

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
