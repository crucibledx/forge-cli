import {basename, relative} from 'node:path'

import {getAllAssistants} from '@domain/assistants/registry'
import type {AssistantConfig, AssistantId} from '@domain/assistants/types'
import type {ProjectConfig, Source} from '@domain/config/types'
import * as prompts from '@infrastructure/cli/prompts'
import * as renderer from '@infrastructure/cli/renderer'
import {projectConfigExists, writeProjectConfig} from '@infrastructure/config'
import {scanForAssistants} from '@infrastructure/fs'
import io from '@infrastructure/io'
import {getSourceLoader, getSourceLoaderOptions} from '@infrastructure/source'

import {INIT_MESSAGES as M} from './messages'
import type {InitCommandAction} from './types'

export const runInit: InitCommandAction = async (options) => {
    let configVersion = 0

    const projectRoot = io.resolveProjectRoot()
    prompts.intro(M.intro)

    // 1. Scan for existing AI configs
    const s = prompts.spinner()
    s.start(M.spinner.scanning)
    const allAssistants = getAllAssistants()
    const detectionResults = await scanForAssistants(projectRoot, allAssistants)
    s.stop(M.spinner.scanDone)

    renderer.renderNewline()
    renderer.renderInfo(M.detected)
    renderer.renderDetectionResults(detectionResults)
    renderer.renderNewline()

    // 2. Abort if config already exists — no overwrite in init
    if (projectConfigExists(projectRoot)) {
        renderer.renderWarning(M.configExists)
        prompts.outro(M.outroCancelled)
        return
    }

    // 3. Ask which assistants to enable — single multiselect, detected pre-selected
    const detectedIds: Set<AssistantId> = new Set(detectionResults
        .filter((r) => r.detected)
        .map((r) => r.id)
    )

    const selectedIds = await prompts.multiselect({
        message: M.assistants.select,
        options: allAssistants.map((a) => ({
            value: a.id,
            label: a.name,
            hint: detectedIds.has(a.id) ? M.assistants.detectedHint : undefined,
        })),
        initialValues: [...detectedIds],
    })

    const assistantConfigs: AssistantConfig[] = selectedIds
        .map((id) =>
            ({id: id as AssistantId, enabled: true}))

    // 4. Ask for source
    let source: Source | undefined

    const addSource = await prompts.confirm({
        message: M.source.addSource,
        initialValue: true,
    })

    if (addSource) {
        const sourceType = await prompts.select({
            message: M.source.selectType,
            options: getSourceLoaderOptions(),
        })

        source = await getSourceLoader(sourceType).configure()
    }

    // 5. Build and write config
    const enabledAssistants = assistantConfigs.filter((a) => a.enabled)

    const config: ProjectConfig = {
        version: `${++configVersion}`,
        project: {
            name: basename(projectRoot),
        },
        assistants: enabledAssistants,
        source,
    }

    const configPath = await writeProjectConfig(projectRoot, config)

    renderer.renderNewline()
    renderer.renderSuccess(M.configWrittenTo(relative(projectRoot, configPath)))
    renderer.renderNewline()

    // 6. Offer to sync now
    if (source) {
        const syncNow = await prompts.confirm({
            message: M.sync.runNow,
            initialValue: true,
        })

        if (syncNow) {
            const {syncCommand} = await import('../sync')
            await syncCommand.action({dryRun: false, verbose: options.verbose})
            return
        }
    }

    prompts.outro(M.outro)
}