import {describe, expect, it, mock, spyOn} from 'bun:test'

// ─── Mocks ────────────────────────────────────────────────────────────────────

const mockProjectConfig = {version: '1', assistants: [], sources: []}

mock.module('@infrastructure/config', () => ({
  loadProjectConfig: async (root: string) => (root === '/has-project' ? mockProjectConfig : null),
  loadSyncState: async () => ({lastSync: '', files: {}}),
  projectConfigExists: (root: string) => root === '/has-project',
}))

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('standaloneIO', () => {
  describe('resolveProjectRoot', () => {
    it('returns process.cwd() by default', async () => {
      const {setGlobalMode, standaloneIO} = await import('./index')
      setGlobalMode(false)
      const cwdSpy = spyOn(process, 'cwd').mockReturnValue('/mocked/cwd')

      expect(standaloneIO.resolveProjectRoot()).toBe('/mocked/cwd')
      cwdSpy.mockRestore()
    })

    it('returns homedir() when global mode is enabled', async () => {
      const {homedir} = await import('node:os')
      const {setGlobalMode, standaloneIO} = await import('./index')
      setGlobalMode(true)

      expect(standaloneIO.resolveProjectRoot()).toBe(homedir())
      setGlobalMode(false)
    })
  })

  describe('globalMode', () => {
    it('defaults to false', async () => {
      const {isGlobalMode, setGlobalMode} = await import('./index')
      setGlobalMode(false)
      expect(isGlobalMode()).toBe(false)
    })

    it('can be toggled', async () => {
      const {isGlobalMode, setGlobalMode} = await import('./index')
      setGlobalMode(true)
      expect(isGlobalMode()).toBe(true)
      setGlobalMode(false)
      expect(isGlobalMode()).toBe(false)
    })
  })

  describe('buildContext', () => {
    it('returns projectRoot unchanged', async () => {
      const {standaloneIO} = await import('./index')
      const ctx = await standaloneIO.buildContext('/any/path')
      expect(ctx.projectRoot).toBe('/any/path')
    })

    it('sets hasProjectConfig true when config file exists', async () => {
      const {standaloneIO} = await import('./index')
      const ctx = await standaloneIO.buildContext('/has-project')
      expect(ctx.hasProjectConfig).toBe(true)
    })

    it('sets hasProjectConfig false when config file does not exist', async () => {
      const {standaloneIO} = await import('./index')
      const ctx = await standaloneIO.buildContext('/no-project')
      expect(ctx.hasProjectConfig).toBe(false)
    })

    it('includes loaded projectConfig when config exists', async () => {
      const {standaloneIO} = await import('./index')
      const ctx = await standaloneIO.buildContext('/has-project')
      expect(ctx.projectConfig).toEqual(mockProjectConfig)
    })

    it('sets projectConfig to null when config does not exist', async () => {
      const {standaloneIO} = await import('./index')
      const ctx = await standaloneIO.buildContext('/no-project')
      expect(ctx.projectConfig).toBeNull()
    })
  })
})
