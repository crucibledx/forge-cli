import {describe, expect, it} from 'bun:test'

import {droid} from '@domain/harnesses/droid'

import {PLUGIN_REGISTRARS, registerDroidSettings} from './registrars'

describe('AC-18 droid plugin capability', () => {
  it('declares the factory emitter and the droid-settings registrar', () => {
    expect(droid.plugin).toEqual({emit: 'factory', register: 'droid-settings', installNote: 'installs on next start'})
    expect(PLUGIN_REGISTRARS['droid-settings']).toBe(registerDroidSettings)
  })
})

describe('registerDroidSettings', () => {
  const input = {marketplace: 'crucible-forge-user', cacheRoot: '/cache/plugins', plugins: ['hello']}

  it('writes the marketplace source and the enabled plugins into the project settings file', () => {
    expect(registerDroidSettings({scope: 'project', ...input})).toEqual({
      path: '.factory/settings.local.json',
      values: [
        {
          key: {kind: 'member', path: ['extraKnownMarketplaces', 'crucible-forge-user']},
          value: {source: {source: 'local', path: '/cache/plugins'}},
        },
        {key: {kind: 'member', path: ['enabledPlugins', 'hello@crucible-forge-user']}, value: true},
      ],
    })
  })

  it('writes into the user settings file for the user scope', () => {
    expect(registerDroidSettings({scope: 'user', ...input}).path).toBe('.factory/settings.json')
  })
})
