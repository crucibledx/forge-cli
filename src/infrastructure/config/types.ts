import type {GlobalConfig, ProjectConfig} from '@domain/config/types'

export type LoadProjectConfigFunction = (projectRoot: string) => Promise<ProjectConfig | null>
export type LoadGlobalConfigFunction = () => Promise<GlobalConfig | null>
export type WriteProjectConfigFunction = (projectRoot: string, config: ProjectConfig) => Promise<string>
export type ProjectConfigExistsFunction = (projectRoot: string) => boolean
export type GetProjectConfigPathFunction = (projectRoot: string) => string
export type GetGlobalConfigPathFunction = () => string

export interface ConfigService {
  loadProjectConfig: LoadProjectConfigFunction
  loadGlobalConfig: LoadGlobalConfigFunction
  writeProjectConfig: WriteProjectConfigFunction
  projectConfigExists: ProjectConfigExistsFunction
  getProjectConfigPath: GetProjectConfigPathFunction
  getGlobalConfigPath: GetGlobalConfigPathFunction
}
