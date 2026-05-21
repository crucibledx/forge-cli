import {getProjectConfigPath, loadProjectConfig, projectConfigExists} from './loader'
import type {ConfigService} from './types'
import {writeProjectConfig} from './writer'

export * from './loader'
export * from './state'
export * from './types'
export * from './writer'

export const configService: ConfigService = {
  loadProjectConfig,
  getProjectConfigPath,
  projectConfigExists,
  writeProjectConfig,
}
