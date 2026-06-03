import {describe, expect, it} from 'bun:test'

import {LOCAL_CONFLICT_STRATEGIES, SOURCE_CONFLICT_STRATEGIES} from '@domain/config/types'

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

describe('projectConfigSchema — sync block', () => {
  it('parses config without sync block (optional)', () => {
    const result = projectConfigSchema.parse({version: '1', assistants: []})
    expect(result.sync).toBeUndefined()
  })

  it('parses a full sync block', () => {
    const raw = {
      version: '1',
      assistants: [],
      sync: {
        source_conflict_strategy: SOURCE_CONFLICT_STRATEGIES.FIRST_WINS,
        local_conflict_strategy: LOCAL_CONFLICT_STRATEGIES.LOCAL_WINS,
        backup: false,
        keep_local: false,
      },
    }
    const result = projectConfigSchema.parse(raw)
    expect(result.sync?.source_conflict_strategy).toBe(SOURCE_CONFLICT_STRATEGIES.FIRST_WINS)
    expect(result.sync?.local_conflict_strategy).toBe(LOCAL_CONFLICT_STRATEGIES.LOCAL_WINS)
    expect(result.sync?.backup).toBe(false)
    expect(result.sync?.keep_local).toBe(false)
  })

  it('parses partial sync block', () => {
    const raw = {
      version: '1',
      assistants: [],
      sync: {backup: true},
    }
    const result = projectConfigSchema.parse(raw)
    expect(result.sync?.backup).toBe(true)
    expect(result.sync?.source_conflict_strategy).toBeUndefined()
  })

  it('rejects invalid source_conflict_strategy', () => {
    expect(() =>
      projectConfigSchema.parse({
        version: '1',
        assistants: [],
        sync: {source_conflict_strategy: 'invalid'},
      }),
    ).toThrow()
  })

  it('rejects invalid local_conflict_strategy', () => {
    expect(() =>
      projectConfigSchema.parse({
        version: '1',
        assistants: [],
        sync: {local_conflict_strategy: 'invalid'},
      }),
    ).toThrow()
  })

  it('accepts valid cron schedule', () => {
    const result = projectConfigSchema.parse({
      version: '1',
      assistants: [],
      sync: {schedule: '0 9 * * 1'},
    })
    expect(result.sync?.schedule).toBe('0 9 * * 1')
  })

  it('accepts interval cron schedule', () => {
    const result = projectConfigSchema.parse({
      version: '1',
      assistants: [],
      sync: {schedule: '*/5 * * * *'},
    })
    expect(result.sync?.schedule).toBe('*/5 * * * *')
  })

  it('rejects invalid cron schedule', () => {
    expect(() =>
      projectConfigSchema.parse({
        version: '1',
        assistants: [],
        sync: {schedule: 'every monday'},
      }),
    ).toThrow('Invalid cron expression')
  })

  it('rejects malformed cron schedule', () => {
    expect(() =>
      projectConfigSchema.parse({
        version: '1',
        assistants: [],
        sync: {schedule: '* * *'},
      }),
    ).toThrow('Invalid cron expression')
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
