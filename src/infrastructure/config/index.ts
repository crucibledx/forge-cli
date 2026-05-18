import {
  getGlobalConfigPath,
  getProjectConfigPath,
  loadGlobalConfig,
  loadProjectConfig,
  projectConfigExists,
} from './loader'
import type {ConfigService} from './types'
import {writeProjectConfig} from './writer'

export * from './loader'
export * from './types'
export * from './writer'

export const configService: ConfigService = {
  loadGlobalConfig,
  loadProjectConfig,
  getProjectConfigPath,
  getGlobalConfigPath,
  projectConfigExists,
  writeProjectConfig,
}
