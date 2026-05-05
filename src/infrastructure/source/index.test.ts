import {describe, expect, it} from 'bun:test'

import {getSourceLoader, getSourceLoaderOptions, sourceLoaders} from './index'

describe('sourceLoaders', () => {
    it('contains a git entry', () => {
        expect(sourceLoaders['git']).toBeDefined()
    })

    it('contains a local entry', () => {
        expect(sourceLoaders['local']).toBeDefined()
    })

    it('git entry has alias "git"', () => {
        expect(sourceLoaders['git'].alias).toBe('git')
    })

    it('git entry has label "Git (SSH / HTTPS)"', () => {
        expect(sourceLoaders['git'].label).toBe('Git (SSH / HTTPS)')
    })

    it('local entry has alias "local"', () => {
        expect(sourceLoaders['local'].alias).toBe('local')
    })

    it('local entry has label "Local directory"', () => {
        expect(sourceLoaders['local'].label).toBe('Local directory')
    })

    it('each entry has a load function', () => {
        for (const loader of Object.values(sourceLoaders)) {
            expect(typeof loader.load).toBe('function')
        }
    })
})

describe('getSourceLoader', () => {
    it('returns the git loader for type "git"', () => {
        const loader = getSourceLoader('git')
        expect(loader.alias).toBe('git')
    })

    it('returns the local loader for type "local"', () => {
        const loader = getSourceLoader('local')
        expect(loader.alias).toBe('local')
    })

    it('throws for unknown source type', () => {
        expect(() => getSourceLoader('ftp')).toThrow('Unsupported source type: "ftp"')
    })

    it('error message lists all available types', () => {
        expect(() => getSourceLoader('s3')).toThrow('Available: git, local')
    })
})

describe('getSourceLoaderOptions', () => {
    it('returns an array of {value, label} entries', () => {
        const opts = getSourceLoaderOptions()
        expect(Array.isArray(opts)).toBe(true)
        expect(opts.length).toBeGreaterThan(0)
        for (const opt of opts) {
            expect(typeof opt.value).toBe('string')
            expect(typeof opt.label).toBe('string')
        }
    })

    it('includes git and local options', () => {
        const opts = getSourceLoaderOptions()
        const values = opts.map((o) => o.value)
        expect(values).toContain('git')
        expect(values).toContain('local')
    })
})
