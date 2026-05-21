import {describe, expect, it} from 'bun:test'

import {globalConfigSchema, projectConfigSchema} from './schema'

describe('projectConfigSchema', () => {
  it('parses a minimal valid config', () => {
    const result = projectConfigSchema.parse({version: '1', assistants: []})
    expect(result.version).toBe('1')
    expect(result.assistants).toEqual([])
    expect(result.sources).toEqual([])
  })

  it('parses a full config with git sources', () => {
    const raw = {
      version: '1',
      project: {name: 'my-project'},
      assistants: [{id: 'cursor', enabled: true}],
      sources: [{name: 'team', type: 'git', url: 'git@github.com:org/repo.git', branch: 'main'}],
      lastSync: '2024-01-01T00:00:00.000Z',
    }
    const result = projectConfigSchema.parse(raw)
    expect(result.sources[0].type).toBe('git')
    expect(result.assistants[0].id).toBe('cursor')
  })

  it('parses a local source in sources array', () => {
    const raw = {
      version: '1',
      assistants: [],
      sources: [{name: 'local', type: 'local', path: '/tmp/skills'}],
    }
    const result = projectConfigSchema.parse(raw)
    expect(result.sources[0].type).toBe('local')
  })

  it('defaults branch to main when missing from git source', () => {
    const raw = {
      version: '1',
      assistants: [],
      sources: [{name: 'team', type: 'git', url: 'git@github.com:org/repo.git'}],
    }
    const result = projectConfigSchema.parse(raw)
    expect((result.sources[0] as unknown as {branch: string}).branch).toBe('main')
  })

  it('migrates v0.1 singular source field into sources array', () => {
    const raw = {
      version: '1',
      assistants: [],
      source: {name: 'team', type: 'git', url: 'git@github.com:org/repo.git', branch: 'main'},
    }
    const result = projectConfigSchema.parse(raw)
    expect(result.sources).toHaveLength(1)
    expect(result.sources[0].type).toBe('git')
    expect((result as Record<string, unknown>).source).toBeUndefined()
  })

  it('prefers sources over legacy source when both present', () => {
    const raw = {
      version: '1',
      assistants: [],
      source: {name: 'old', type: 'local', path: '/old'},
      sources: [{name: 'new', type: 'local', path: '/new'}],
    }
    const result = projectConfigSchema.parse(raw)
    expect(result.sources).toHaveLength(1)
    expect(result.sources[0].name).toBe('new')
  })

  it('rejects invalid assistant id', () => {
    expect(() =>
      projectConfigSchema.parse({
        version: '1',
        assistants: [{id: 'not-a-real-tool', enabled: true}],
      }),
    ).toThrow()
  })

  it('rejects unknown source type in sources array', () => {
    expect(() =>
      projectConfigSchema.parse({
        version: '1',
        assistants: [],
        sources: [{name: 'x', type: 'ftp', path: '/foo'}],
      }),
    ).toThrow()
  })
})

describe('globalConfigSchema', () => {
  it('uses the same schema as projectConfigSchema', () => {
    const result = globalConfigSchema.parse({
      version: '1',
      assistants: [{id: 'windsurf', enabled: true}],
      sources: [{name: 'global', type: 'git', url: 'git@github.com:org/g.git', branch: 'main'}],
    })
    expect(result.assistants[0].id).toBe('windsurf')
    expect(result.sources[0].name).toBe('global')
  })
})
