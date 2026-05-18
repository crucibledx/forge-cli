import type {AssistantConfig} from '../assistants/types'

export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P]
}

export interface Source {
  name: string
  type: string
  [key: string]: unknown
}

export interface ProjectConfig {
  version: string
  project?: {
    name: string
    description?: string
  }
  assistants: AssistantConfig[]
  sources: Source[]
  lastSync?: string
}

export interface GlobalConfig {
  version: string
  user?: {
    name: string
  }
  defaults?: {
    assistants?: AssistantConfig[]
    sources?: Source[]
  }
}
