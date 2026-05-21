import type {ProjectConfig} from '@domain/config/types'

export type LoadProjectConfigFunction = (projectRoot: string) => Promise<ProjectConfig | null>
export type WriteProjectConfigFunction = (projectRoot: string, config: ProjectConfig) => Promise<string>
export type ProjectConfigExistsFunction = (projectRoot: string) => boolean
export type GetProjectConfigPathFunction = (projectRoot: string) => string

export interface ConfigService {
  loadProjectConfig: LoadProjectConfigFunction
  writeProjectConfig: WriteProjectConfigFunction
  projectConfigExists: ProjectConfigExistsFunction
  getProjectConfigPath: GetProjectConfigPathFunction
}
