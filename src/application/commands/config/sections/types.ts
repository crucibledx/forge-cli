import type {ProjectConfig} from '@domain/config/types'

export interface ConfigSectionEntry {
    id: string
    label: string
    hint: (config: ProjectConfig) => string
    edit: (config: ProjectConfig, projectRoot: string) => Promise<ProjectConfig>
}
