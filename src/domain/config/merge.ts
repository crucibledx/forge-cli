import type {AssistantConfig} from '../assistants/types'
import type {GlobalConfig, ProjectConfig} from './types'

export function mergeConfigs(
    global: GlobalConfig | null,
    project: ProjectConfig | null,
): ProjectConfig {
    if (!global && !project) return defaultConfig()
    if (!global) return project!
    if (!project) return globalAsProject(global)

    return {
        ...project,
        assistants: mergeAssistants(
            global.defaults?.assistants ?? [],
            project.assistants,
        ),
        sources: project.sources.length > 0
            ? project.sources
            : (global.defaults?.sources ?? []),
    }
}

function mergeAssistants(
    globalAssistants: AssistantConfig[],
    projectAssistants: AssistantConfig[],
): AssistantConfig[] {
    if (projectAssistants.length > 0) return projectAssistants
    return globalAssistants
}

function globalAsProject(global: GlobalConfig): ProjectConfig {
    return {
        version: global.version,
        assistants: global.defaults?.assistants ?? [],
        sources: global.defaults?.sources ?? [],
    }
}

function defaultConfig(): ProjectConfig {
    return {
        version: '1',
        assistants: [],
        sources: [],
    }
}
