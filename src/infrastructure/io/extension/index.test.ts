import {describe, expect, it} from 'bun:test'

import {extensionIO} from './index'

describe('extensionIO', () => {
  it('buildContext throws not-implemented error', async () => {
    expect(extensionIO.buildContext('/any')).rejects.toThrow('Extension mode is not implemented in v0.1.')
  })

  it('resolveProjectRoot throws not-implemented error', () => {
    expect(() => extensionIO.resolveProjectRoot()).toThrow('Extension mode is not implemented in v0.1.')
  })
})
