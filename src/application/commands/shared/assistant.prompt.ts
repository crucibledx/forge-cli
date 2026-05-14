import {getAllAssistants} from '@domain/assistants/registry'
import type {AssistantConfig, AssistantDefinition, AssistantId, DetectionResult} from '@domain/assistants/types'
import * as prompts from '@infrastructure/cli/prompts'
import * as renderer from '@infrastructure/cli/renderer'
import {scanForAssistants} from '@infrastructure/fs'

// ─── Messages ────────────────────────────────────────────────────────────────

export const ASSISTANT_PROMPT_MESSAGES = {
    scanning: 'Scanning for AI configs...',
    scanDone: 'Scan complete',
    select: 'Select assistants to enable:',
    detectedHint: 'detected',
    detectedGlobalHint: 'detected globally',
    noneSelected: 'No assistants selected.',
} as const

// ─── Scan ────────────────────────────────────────────────────────────────────

export interface AssistantScanResult {
    allAssistants: readonly AssistantDefinition[]
    detectionResults: DetectionResult[]
}

export function runAssistantScan(projectRoot: string): AssistantScanResult {
    const M = ASSISTANT_PROMPT_MESSAGES
    const s = prompts.spinner()
    s.start(M.scanning)
    const allAssistants = getAllAssistants()
    const detectionResults = scanForAssistants(projectRoot, allAssistants)
    s.stop(M.scanDone)
    return {allAssistants, detectionResults}
}

// ─── Selection ───────────────────────────────────────────────────────────────

export async function promptAssistantSelection(
    scan: AssistantScanResult,
    initialIds: AssistantId[],
): Promise<AssistantConfig[]> {
    const M = ASSISTANT_PROMPT_MESSAGES
    const {allAssistants, detectionResults} = scan
    const detectionByAssistant = new Map(detectionResults.map((r) => [r.id, r]))

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
        initialValues: initialIds,
    })

    if (selectedIds.length === 0) {
        renderer.renderWarning(M.noneSelected)
    }

    return selectedIds.map((id) => ({id: id as AssistantId, enabled: true}))
}
