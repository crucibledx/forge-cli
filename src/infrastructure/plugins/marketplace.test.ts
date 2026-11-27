import {describe, expect, it} from 'bun:test'

import type {PluginLockEntry} from '@domain/plugins'

import {marketplaceCatalog, marketplaceName} from './marketplace'

const entry = (name: string, version: string): PluginLockEntry => ({
  name,
  version,
  source: {type: 'local', path: '/x'},
  contentHash: 'a'.repeat(64),
  outputs: {droid: 'b'.repeat(64)},
})

describe('marketplaceName', () => {
  it('names the user cache root crucible-forge-user and each project by its canonical root', () => {
    expect(marketplaceName('user', '/any/root')).toBe('crucible-forge-user')
    const a = marketplaceName('project', '/home/forge/project-a')
    const b = marketplaceName('project', '/home/forge/project-b')
    expect(a).toMatch(/^crucible-forge-[a-f0-9]{12}$/)
    expect(b).toMatch(/^crucible-forge-[a-f0-9]{12}$/)
    expect(a).not.toBe(b)
    expect(marketplaceName('project', '/home/forge/project-a')).toBe(a)
  })
})

describe('marketplaceCatalog', () => {
  it('lists one relative-path entry per plugin delivered to the harness', () => {
    const catalog = JSON.parse(marketplaceCatalog('crucible-forge-user', 'droid', [entry('hello', '1.0.0')]))
    expect(catalog).toEqual({
      name: 'crucible-forge-user',
      owner: {name: 'Crucible Forge'},
      plugins: [{name: 'hello', version: '1.0.0', source: './hello/1.0.0/droid'}],
    })
  })

  it('writes an empty catalog when nothing is delivered to the harness', () => {
    expect(JSON.parse(marketplaceCatalog('m', 'claude-code', [])).plugins).toEqual([])
  })
})
