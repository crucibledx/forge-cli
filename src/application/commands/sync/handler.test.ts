import {describe, expect, it} from 'bun:test'

import {CommandError} from '../types'
import {validateConfig} from './handler'

describe('sync configuration validation', () => {
  it('requires a configured source even for deliberate cleanup', () => {
    expect(() => validateConfig({version: '1', sources: [], harnesses: [{id: 'cursor', enabled: true}]})).toThrow(
      CommandError,
    )
  })
  it('requires an enabled harness', () => {
    expect(() =>
      validateConfig({
        version: '1',
        sources: [{name: 'local', type: 'local'}],
        harnesses: [{id: 'cursor', enabled: false}],
      }),
    ).toThrow(CommandError)
  })
  it('accepts a configured source and enabled harness', () => {
    expect(() =>
      validateConfig({
        version: '1',
        sources: [{name: 'local', type: 'local'}],
        harnesses: [{id: 'cursor', enabled: true}],
      }),
    ).not.toThrow()
  })
})
