import {describe, expect, it} from 'bun:test'

import {CommandError} from '../types'
import {validateConfig} from './handler'

describe('sync configuration validation', () => {
  it('requires a configured source even for deliberate cleanup', () => {
    expect(() => validateConfig({version: '1', sources: [], assistants: [{id: 'cursor', enabled: true}]})).toThrow(
      CommandError,
    )
  })
  it('requires an enabled assistant', () => {
    expect(() =>
      validateConfig({
        version: '1',
        sources: [{name: 'local', type: 'local'}],
        assistants: [{id: 'cursor', enabled: false}],
      }),
    ).toThrow(CommandError)
  })
  it('accepts a configured source and enabled assistant', () => {
    expect(() =>
      validateConfig({
        version: '1',
        sources: [{name: 'local', type: 'local'}],
        assistants: [{id: 'cursor', enabled: true}],
      }),
    ).not.toThrow()
  })
})
