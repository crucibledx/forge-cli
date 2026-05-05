import type {AssistantConfig} from '../assistants/types'

export type DeepPartial<T> = {
    [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P]
}

export interface GitSource {
    name: string
    type: 'git'
    url: string
    branch: string
    path?: string
    auth?: {
        type: 'ssh-key' | 'token'
        keyPath?: string
        token?: string
    }
}

export interface LocalSource {
    name: string
    type: 'local'
    path: string
}

export type Source = GitSource | LocalSource

export interface ProjectConfig {
    version: string
    project?: {
        name: string
        description?: string
    }
    assistants: AssistantConfig[]
    source?: Source
    lastSync?: string
}

export interface GlobalConfig {
    version: string
    user?: {
        name: string
    }
    defaults?: {
        assistants?: AssistantConfig[]
        source?: Source
    }
}
