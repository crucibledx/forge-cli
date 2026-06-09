import {homedir} from 'node:os'

import {loadProjectConfig, projectConfigExists} from '@infrastructure/config'

import type {IOService} from '../types'

let globalMode = false

export function setGlobalMode(enabled: boolean): void {
  globalMode = enabled
}

export function isGlobalMode(): boolean {
  return globalMode
}

export const standaloneIO: IOService = {
  buildContext: async (projectRoot) => {
    const projectConfig = await loadProjectConfig(projectRoot)
    const hasProjectConfig = projectConfigExists(projectRoot)

    return {
      projectRoot,
      projectConfig,
      hasProjectConfig,
    }
  },
  resolveProjectRoot: () => (globalMode ? homedir() : process.cwd()),
}
