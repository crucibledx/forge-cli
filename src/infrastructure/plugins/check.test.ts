import {describe, expect, it} from 'bun:test'

import {pluginManifest} from '@e2e/fixtures/plugin-packages'

import {checkPluginFiles} from './check'

const file = (path: string, text: string) => ({path, content: new TextEncoder().encode(text)})
const manifest = file('plugin.json', pluginManifest('hooks-demo', '1.0.0'))
const hooks = (value: string) => [manifest, file('dev.crucibledx.forge/hooks/hooks.json', value)]

describe('hooks.json validation', () => {
  it('accepts the wrapped and the direct event-map shapes', () => {
    expect(checkPluginFiles(hooks('{"hooks": {"SessionStart": []}}')).errors).toEqual([])
    expect(checkPluginFiles(hooks('{"SessionStart": []}')).errors).toEqual([])
  })

  it('rejects a non-object document, a non-object wrapper and non-array events, naming the path', () => {
    for (const value of ['[]', 'null', '"text"'])
      expect(checkPluginFiles(hooks(value)).errors[0]).toContain('dev.crucibledx.forge/hooks/hooks.json')
    expect(checkPluginFiles(hooks('{"hooks": []}')).errors[0]).toContain('"hooks"')
    expect(checkPluginFiles(hooks('{"hooks": {"SessionStart": {}}}')).errors[0]).toContain('SessionStart')
    expect(checkPluginFiles(hooks('{"SessionStart": {}}')).errors[0]).toContain('SessionStart')
  })
})

describe('reserved forge/ directory', () => {
  it('rejects package files under forge/, reserved for forge-generated plugin files', () => {
    const errors = checkPluginFiles([manifest, file('forge/rules.md', '# Authored')]).errors
    expect(errors[0]).toContain('forge/rules.md')
    expect(errors[0]).toContain('reserved')
  })
})
