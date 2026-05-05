import type {GlobalConfig, ProjectConfig} from '../config/types'
import type {Mutation} from '../sync/types'

export interface PluginRequest {
    version: '1'
    command: string
    subcommand?: string
    args: string[]
    flags: Record<string, unknown>
    context: {
        globalConfig: GlobalConfig | null
        projectConfig: ProjectConfig | null
        projectRoot: string
        crucibleDir: string
        isInteractive: boolean
        dryRun: boolean
    }
}

export interface OutputEntry {
    level: 'info' | 'warn' | 'error' | 'debug' | 'success'
    message: string
    detail?: string
}

export interface PluginResponse {
    version: '1'
    status: 'success' | 'error' | 'partial'
    output: OutputEntry[]
    mutations: Mutation[]
    configUpdates: Array<{
        scope: 'project' | 'global'
        path: string
        value: unknown
        reason: string
    }>
    prompts?: Array<{
        id: string
        type: 'select' | 'multiselect' | 'text' | 'confirm'
        message: string
        choices?: Array<{value: string, label: string, hint?: string}>
        default?: unknown
    }>
    error?: {
        code: string
        message: string
        recoverable: boolean
        suggestion?: string
    }
}
