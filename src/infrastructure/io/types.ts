import type {GlobalConfig, ProjectConfig} from '@domain/config/types'

export interface IOContext {
    projectRoot: string
    globalConfig: GlobalConfig | null
    projectConfig: ProjectConfig | null
    hasProjectConfig: boolean
}

export interface IOService {
    buildContext: (projectRoot: string) => Promise<IOContext>
    resolveProjectRoot: () => string
}
