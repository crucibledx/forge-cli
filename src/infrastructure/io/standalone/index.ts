import {
    loadGlobalConfig,
    loadProjectConfig,
    projectConfigExists,
} from '@infrastructure/config'

import type {IOService} from '../types'

export const standaloneIO: IOService = {
    buildContext: async (projectRoot) => {
        const globalConfig = await loadGlobalConfig()
        const projectConfig = await loadProjectConfig(projectRoot)
        const hasProjectConfig = projectConfigExists(projectRoot)

        return {
            projectRoot,
            globalConfig,
            projectConfig,
            hasProjectConfig,
        }
    },
    resolveProjectRoot: () => process.cwd(),
}
