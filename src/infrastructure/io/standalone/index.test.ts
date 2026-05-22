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
    it('returns process.cwd()', async () => {
      const {standaloneIO} = await import('./index')
      const cwdSpy = spyOn(process, 'cwd').mockReturnValue('/mocked/cwd')

      expect(standaloneIO.resolveProjectRoot()).toBe('/mocked/cwd')
      cwdSpy.mockRestore()
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
