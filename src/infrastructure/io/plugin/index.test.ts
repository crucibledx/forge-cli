import {describe, expect, it} from 'bun:test'

import {pluginIO} from './index'

describe('pluginIO', () => {
    it('buildContext throws not-implemented error', async () => {
        expect(pluginIO.buildContext('/any')).rejects.toThrow(
            'Plugin mode is not implemented in v0.1.',
        )
    })

    it('resolveProjectRoot throws not-implemented error', () => {
        expect(() => pluginIO.resolveProjectRoot()).toThrow(
            'Plugin mode is not implemented in v0.1.',
        )
    })
})
