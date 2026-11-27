import {describe, expect, it} from 'bun:test'

import {claudeCode} from '@domain/harnesses/claude-code'
import {PLUGIN_EMITTERS} from '@domain/plugins'
import {emitClaude} from '@domain/plugins/emit'

import {mergeKeyed} from '../config/keyed-merge'
import {registerClaudeSettings} from './claude-settings'
import {PLUGIN_REGISTRARS} from './registrars'

const cacheRoot = '/work/app/.crucible/plugins'
const marketplace = 'crucible-forge-0123456789ab'

describe('AC-10 claude-settings registrar', () => {
  it('is what the claude-code plugin capability resolves to, with the claude emitter', () => {
    expect(claudeCode.plugin).toEqual({
      emit: 'claude',
      register: 'claude-settings',
      installNote: 'installs on next start, once you trust the folder',
    })
    expect(PLUGIN_EMITTERS[claudeCode.plugin!.emit]).toBe(emitClaude)
    expect(PLUGIN_REGISTRARS[claudeCode.plugin!.register]).toBe(registerClaudeSettings)
  })

  it('declares the cache root as a directory marketplace and enables each plugin in the local settings file', () => {
    expect(registerClaudeSettings({scope: 'project', marketplace, cacheRoot, plugins: ['cover-all', 'hello']})).toEqual(
      {
        path: '.claude/settings.local.json',
        values: [
          {
            key: {kind: 'member', path: ['extraKnownMarketplaces', marketplace]},
            value: {source: {source: 'directory', path: cacheRoot}},
          },
          {key: {kind: 'member', path: ['enabledPlugins', `cover-all@${marketplace}`]}, value: true},
          {key: {kind: 'member', path: ['enabledPlugins', `hello@${marketplace}`]}, value: true},
        ],
      },
    )
  })

  it('writes the user settings file in a user sync', () => {
    const registration = registerClaudeSettings({
      scope: 'user',
      marketplace: 'crucible-forge-user',
      cacheRoot: '/home/me/.crucible/forge/plugins',
      plugins: ['hello'],
    })
    expect(registration.path).toBe('.claude/settings.json')
    expect(registration.values.map((v) => v.key.path.join('/'))).toEqual([
      'extraKnownMarketplaces/crucible-forge-user',
      'enabledPlugins/hello@crucible-forge-user',
    ])
  })

  it('merges into existing settings without touching other keys', () => {
    const text =
      '{\n  // team defaults\n  "permissions": {"allow": ["Bash(ls)"]},\n  "enabledPlugins": {"other@x": false}\n}\n'
    const {values} = registerClaudeSettings({scope: 'project', marketplace, cacheRoot, plugins: ['hello']})
    const merged = mergeKeyed({text, owned: {}, desired: values, drift: 'block'})
    expect(merged.content).toContain('// team defaults')
    expect(JSON.parse(merged.content!.replace('// team defaults\n', ''))).toEqual({
      permissions: {allow: ['Bash(ls)']},
      enabledPlugins: {'other@x': false, [`hello@${marketplace}`]: true},
      extraKnownMarketplaces: {[marketplace]: {source: {source: 'directory', path: cacheRoot}}},
    })
  })
})
