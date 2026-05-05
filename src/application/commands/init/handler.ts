import {basename, relative} from 'node:path'

import {getAllAssistants} from '@domain/assistants/registry'
import type {AssistantConfig} from '@domain/assistants/types'
import type {GitSource, ProjectConfig} from '@domain/config/types'
import * as prompts from '@infrastructure/cli/prompts'
import * as renderer from '@infrastructure/cli/renderer'
import {projectConfigExists, writeProjectConfig} from '@infrastructure/config'
import {scanForAssistants} from '@infrastructure/fs'
import io from '@infrastructure/io'

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

    // 2. Check if config already exists
    if (projectConfigExists(projectRoot)) {
        // FIXME: set version from existing config
        //  maybe even just load existing config and override specific information
        //  can be in later version, when config can be changed via CLI (e.g. add new source/assistant)
        renderer.renderWarning(M.existingConfig)
        const overwrite = await prompts.confirm({
            message: M.overwriteExisting,
            initialValue: false,
        })
        if (!overwrite) {
            prompts.outro(M.outroCancelled)
            return
        }
    }

    // 3. Ask which assistants to enable
    const assistantConfigs: AssistantConfig[] = []

    for (const result of detectionResults) {
        if (result.detected) {
            const keep = await prompts.confirm({
                message: M.assistants.keepDetected(result.name),
                initialValue: true,
            })
            assistantConfigs.push({id: result.id, enabled: keep})
        } else {
            const add = await prompts.confirm({
                message: M.assistants.addUndetected(result.name),
                initialValue: false,
            })
            if (add) {
                assistantConfigs.push({id: result.id, enabled: true})
            }
        }
    }

    // 4. Ask for source
    // TODO: refactor, so we can ask which source to add (e.g. git, local, CDN, etc.)
    let source: GitSource | undefined

    const addSource = await prompts.confirm({
        message: M.source.addSource,
        initialValue: true,
    })

    if (addSource) {
        const url = await prompts.text({
            message: M.source.url.message,
            placeholder: M.source.url.placeholder,
            validate: (val) => {
                if (!val?.trim()) return M.source.url.required
                return undefined
            },
        })

        const branch = await prompts.text({
            message: M.source.branch,
            placeholder: 'main',
            defaultValue: 'main',
        })

        const path = await prompts.text({
            message: M.source.subdirectory.message,
            placeholder: M.source.subdirectory.placeholder,
        })

        source = {
            name: M.source.defaultName,
            type: 'git',
            url: url.trim(),
            branch: branch?.trim(),
            path: path?.trim(),
        }
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