import {describe, expect, it} from 'bun:test'

import type {PluginConfig} from '@domain/plugins'

import {CommandError} from '../types'
import {validatePluginScopes} from './plugins'

const entry = (scope?: 'project' | 'user'): PluginConfig => ({
  name: 'hello',
  source: {type: 'local', path: '/x'},
  ...(scope ? {scope} : {}),
})

describe('validatePluginScopes (spec 0003 §4)', () => {
  it('lets matching and defaulted scopes pass', () => {
    expect(() => validatePluginScopes([entry(), entry('project')], 'project')).not.toThrow()
    expect(() => validatePluginScopes([entry(), entry('user')], 'user')).not.toThrow()
    expect(() => validatePluginScopes([], 'project')).not.toThrow()
  })

  it('rejects a user entry in the project config, naming where it belongs and the command', () => {
    try {
      validatePluginScopes([entry('user')], 'project')
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(CommandError)
      const commandError = error as CommandError
      expect(commandError.message).toContain('"hello" has scope: user')
      expect(commandError.message).toContain('project config')
      expect(commandError.suggestion).toContain('~/.crucible/forge.config.yaml')
      expect(commandError.suggestion).toContain('forge sync --global')
    }
  })

  it('rejects a project entry in the user config, naming where it belongs and the command', () => {
    try {
      validatePluginScopes([entry('project')], 'user')
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(CommandError)
      const commandError = error as CommandError
      expect(commandError.message).toContain('"hello" has scope: project')
      expect(commandError.message).toContain('user config')
      expect(commandError.suggestion).toContain('.crucible/forge.config.yaml')
      expect(commandError.suggestion).toContain('forge sync')
    }
  })
})
