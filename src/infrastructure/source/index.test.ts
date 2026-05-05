import {describe, expect, it} from 'bun:test'

import {getSourceLoader, sourceLoaders} from './index'

describe('sourceLoaders', () => {
    it('contains a git entry', () => {
        expect(sourceLoaders['git']).toBeDefined()
    })

    it('git entry has alias "git"', () => {
        expect(sourceLoaders['git'].alias).toBe('git')
    })

    it('git entry has a load function', () => {
        expect(typeof sourceLoaders['git'].load).toBe('function')
    })
})

describe('getSourceLoader', () => {
    it('returns the git loader for type "git"', () => {
        const loader = getSourceLoader('git')
        expect(loader.alias).toBe('git')
    })

    it('throws for unknown source type', () => {
        expect(() => getSourceLoader('ftp')).toThrow('Unsupported source type: "ftp"')
    })

    it('error message lists available types', () => {
        expect(() => getSourceLoader('s3')).toThrow('Available: git')
    })
})
