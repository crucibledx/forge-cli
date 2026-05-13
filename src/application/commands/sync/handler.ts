import {existsSync} from 'node:fs'
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'

import {groupBy} from 'lodash-es'

import {getAssistant} from '@domain/assistants/registry'
import type {AssistantId} from '@domain/assistants/types'
import {mergeConfigs} from '@domain/config/merge'
import {resolveTargets} from '@domain/sync/resolver'
import type {Mutation, SyncFileSummary} from '@domain/sync/types'
import * as prompts from '@infrastructure/cli/prompts'
import * as renderer from '@infrastructure/cli/renderer'
import {writeProjectConfig} from '@infrastructure/config'
import {applyMutations, collectFiles, rollbackMutations} from '@infrastructure/fs'
import io from '@infrastructure/io'
import {getSourceLoader} from '@infrastructure/source'

import type {SyncCommandAction} from './types'

export const runSync: SyncCommandAction = async (options) => {
    const projectRoot = io.resolveProjectRoot()
    const context = await io.buildContext(projectRoot)
    const config = mergeConfigs(context.globalConfig, context.projectConfig)

    if (config.sources.length === 0) {
        renderer.renderError(
            'No source configured',
            'Run `forge init` to configure a source',
        )
        process.exit(1)
    }

    if (config.assistants?.every((a) => !a.enabled)) {
        renderer.renderError(
            'No assistants enabled',
            'Run `forge init` to configure assistants',
        )
        process.exit(1)
    }

    const source = config.sources[0]
    const loader = getSourceLoader(source.type)

    renderer.renderNewline()
    renderer.renderInfo(`Syncing from source: ${source.name}`)
    renderer.renderDim(`Pulling ${source.type} source (${source.name})...`)

    const s = prompts.spinner()
    s.start('Fetching source...')
    const {localPath} = await loader.load(source)
    s.stop('Source ready')

    renderer.renderNewline()

    // Collect source files
    const sourcePath = source.type === 'git' && source.path
        ? join(localPath, source.path)
        : localPath
    const sourceFiles = await collectFiles(sourcePath)

    if (sourceFiles.length === 0) {
        renderer.renderWarning('No files found in source')
        return
    }

    // Resolve targets
    const assistantDefs = config.assistants.map((a) => getAssistant(a.id))
    const resolved = resolveTargets(sourceFiles, assistantDefs)

    if (resolved.length === 0) {
        renderer.renderWarning('No files matched any target mapping')
        return
    }

    // Build plan — check existing files to determine status
    const mutations: Mutation[] = []
    const summaries: SyncFileSummary[] = []

    for (const target of resolved) {
        const fullPath = join(projectRoot, target.targetPath)
        let status: 'new' | 'update' | 'no_change' = 'new'

        if (existsSync(fullPath)) {
            const existing = await readFile(fullPath, 'utf-8')
            status = existing === target.content ? 'no_change' : 'update'
        }

        summaries.push({
            targetPath: target.targetPath,
            sourcePath: target.sourcePath,
            assistantId: target.assistantId,
            status,
        })

        if (status !== 'no_change') {
            mutations.push({
                type: 'file_write',
                path: target.targetPath,
                content: target.content,
            })
        }
    }

    // Display results grouped by assistant
    const byAssistant = groupBy(summaries, (item) => item.assistantId)

    if (options.dryRun) {
        renderer.renderInfo(`Would sync from source: ${source.name}`)
        renderer.renderNewline()
    }

    for (const [assistantId, files] of Object.entries(byAssistant)) {
        const def = getAssistant(assistantId as AssistantId)
        renderer.render(`${def.name}:`)
        for (const file of files) {
            renderer.renderSyncFile(file.targetPath, file.status, options.dryRun)
        }
        renderer.renderNewline()
    }

    if (options.dryRun) {
        renderer.renderDim('Run without --dry-run to apply.')
        return
    }

    // Apply mutations
    const applied = await applyMutations(projectRoot, mutations)
    const failed = applied.find((a) => !a.success)

    if (failed) {
        renderer.renderError(`Failed: ${failed.error}`)
        renderer.renderDim('Rolling back...')
        await rollbackMutations(projectRoot, applied)
        renderer.renderDim('Rollback complete')
        process.exit(1)
    }

    // Update lastSync in config
    if (context.projectConfig) {
        const updated = {
            ...context.projectConfig,
            lastSync: new Date().toISOString(),
        }
        await writeProjectConfig(projectRoot, updated)
    }

    const changeCount = summaries.filter((item) => item.status !== 'no_change').length
    renderer.renderSuccess(`Done. ${changeCount} files synced from ${source.name}.`)
    renderer.renderDim(
        `Last sync: ${new Date().toISOString().replace('T', ' ').slice(0, 16)}`,
    )
}
