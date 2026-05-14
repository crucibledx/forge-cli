import {getAllAssistants} from '@domain/assistants/registry'
import type {AssistantConfig, AssistantId} from '@domain/assistants/types'
import * as prompts from '@infrastructure/cli/prompts'
import * as renderer from '@infrastructure/cli/renderer'
import {scanForAssistants} from '@infrastructure/fs'

import type {ConfigSectionEntry} from './types'

export const ASSISTANTS_MESSAGES = {
    scanning: 'Scanning for AI configs...',
    scanDone: 'Scan complete',
    select: 'Select assistants to enable:',
    detectedHint: 'detected',
    detectedGlobalHint: 'detected globally',
    noneSelected: 'No assistants selected.',
} as const

export const assistantsSection: ConfigSectionEntry = {
    id: 'assistants',
    label: 'Assistants',

    hint: (config) => {
        const enabled = config.assistants.filter((a) => a.enabled)
        return enabled.length > 0
            ? `${enabled.length} enabled`
            : 'none enabled'
    },

    edit: async (config, projectRoot) => {
        const M = ASSISTANTS_MESSAGES

        const s = prompts.spinner()
        s.start(M.scanning)
        const allAssistants = getAllAssistants()
        const detectionResults = scanForAssistants(projectRoot, allAssistants)
        s.stop(M.scanDone)

        renderer.renderNewline()

        const detectionByAssistant = new Map(detectionResults.map((r) => [r.id, r]))
        const enabledIds = new Set(config.assistants.filter((a) => a.enabled)
            .map((a) => a.id))

        const selectedIds = await prompts.multiselect({
            message: M.select,
            options: allAssistants.map((a) => {
                const result = detectionByAssistant.get(a.id)
                let hint: string | undefined
                if (result?.detected) {
                    hint = result.scope === 'global'
                        ? (result.evidence?.split(', ')[0] ?? M.detectedGlobalHint)
                        : M.detectedHint
                }
                return {value: a.id, label: a.name, hint}
            }),
            initialValues: [...enabledIds],
        })

        if (selectedIds.length === 0) {
            renderer.renderWarning(M.noneSelected)
        }

        const assistants: AssistantConfig[] = selectedIds.map((id) => ({
            id: id as AssistantId,
            enabled: true,
        }))

        return {...config, assistants}
    },
}
