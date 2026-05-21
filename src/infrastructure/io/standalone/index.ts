import {loadProjectConfig, projectConfigExists} from '@infrastructure/config'

import type {IOService} from '../types'

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
  resolveProjectRoot: () => process.cwd(),
}
