import {homedir} from 'node:os'

import {isGlobalMode} from '@domain/scope'
import {loadProjectConfig, projectConfigExists} from '@infrastructure/config'

import type {IOService} from '../types'

export {isGlobalMode, setGlobalMode} from '@domain/scope'

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
  resolveProjectRoot: () => (isGlobalMode() ? homedir() : process.cwd()),
}
