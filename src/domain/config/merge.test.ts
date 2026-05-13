import {describe, expect, it} from 'bun:test'

import type {AssistantConfig} from '@domain/assistants/types'

import {mergeConfigs} from './merge'
import type {GlobalConfig, ProjectConfig} from './types'

const projectConfig: ProjectConfig = {
    version: '1',
    assistants: [{id: 'cursor', enabled: true}],
    sources: [{name: 'proj-src', type: 'git', url: 'git@github.com:org/repo.git', branch: 'main'}],
}

const globalConfig: GlobalConfig = {
    version: '1',
    defaults: {
        assistants: [{id: 'claude-code', enabled: true}],
        sources: [{name: 'global-src', type: 'git', url: 'git@github.com:org/global.git', branch: 'main'}],
    },
}

describe('mergeConfigs', () => {
    it('returns default config when both null', () => {
        const result = mergeConfigs(null, null)
        expect(result.version).toBe('1')
        expect(result.assistants).toEqual([])
        expect(result.sources).toEqual([])
    })

    it('returns project config when global is null', () => {
        const result = mergeConfigs(null, projectConfig)
        expect(result).toEqual(projectConfig)
    })

    it('converts global to project when project is null', () => {
        const result = mergeConfigs(globalConfig, null)
        expect(result.assistants).toEqual(globalConfig.defaults!.assistants as AssistantConfig[])
        expect(result.sources).toEqual(globalConfig.defaults!.sources!)
    })

    it('project assistants take precedence over global defaults', () => {
        const result = mergeConfigs(globalConfig, projectConfig)
        expect(result.assistants).toEqual(projectConfig.assistants)
    })

    it('project sources take precedence over global sources', () => {
        const result = mergeConfigs(globalConfig, projectConfig)
        expect(result.sources).toEqual(projectConfig.sources)
    })

    it('falls back to global sources when project has empty array', () => {
        const noSources: ProjectConfig = {...projectConfig, sources: []}
        const result = mergeConfigs(globalConfig, noSources)
        expect(result.sources).toEqual(globalConfig.defaults!.sources!)
    })

    it('falls back to global assistants when project has empty array', () => {
        const noAssistants: ProjectConfig = {...projectConfig, assistants: []}
        const result = mergeConfigs(globalConfig, noAssistants)
        expect(result.assistants).toEqual(globalConfig.defaults!.assistants as AssistantConfig[])
    })

    it('preserves project-level metadata', () => {
        const withMeta: ProjectConfig = {
            ...projectConfig,
            project: {name: 'my-project', description: 'desc'},
        }
        const result = mergeConfigs(globalConfig, withMeta)
        expect(result.project).toEqual(withMeta.project)
    })
})
