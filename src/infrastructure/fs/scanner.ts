import {existsSync, readdirSync} from 'node:fs'
import {homedir} from 'node:os'
import {join} from 'node:path'

import type {AssistantDefinition, DetectionResult} from '@domain/assistants/types'

function resolvePath(projectRoot: string, homeDir: string, path: string): string {
    return path.startsWith('~/') ? join(homeDir, path.slice(2)) : join(projectRoot, path)
}

function isGlobal(path: string): boolean {
    return path.startsWith('~/')
}

export function scanForAssistants(
    projectRoot: string,
    assistants: readonly AssistantDefinition[],
    homeDir = homedir(),
): DetectionResult[] {
    return assistants.map((assistant) => detectAssistant(projectRoot, homeDir, assistant))
}

function detectAssistant(
    projectRoot: string,
    homeDir: string,
    assistant: AssistantDefinition,
): DetectionResult {
    const projectEvidence: string[] = []
    const globalEvidence: string[] = []

    for (const dir of assistant.detection.directories) {
        const fullPath = resolvePath(projectRoot, homeDir, dir)
        if (!existsSync(fullPath)) continue

        let label: string
        try {
            const entries = readdirSync(fullPath)
            const count = entries.filter((e) => !e.startsWith('.')).length
            label = count > 0 ? `${dir}/ found (${count} items)` : `${dir}/ found (empty)`
        } catch {
            label = `${dir}/ found`
        }

        if (isGlobal(dir)) globalEvidence.push(label)
        else projectEvidence.push(label)
    }

    for (const file of assistant.detection.files) {
        const fullPath = resolvePath(projectRoot, homeDir, file)
        if (!existsSync(fullPath)) continue

        const label = `${file} found`
        if (isGlobal(file)) globalEvidence.push(label)
        else projectEvidence.push(label)
    }

    const allEvidence = [...projectEvidence, ...globalEvidence]
    const scope = projectEvidence.length > 0 ? 'project' : globalEvidence.length > 0 ? 'global' : undefined

    return {
        id: assistant.id,
        name: assistant.name,
        detected: allEvidence.length > 0,
        scope,
        evidence: allEvidence.length > 0 ? allEvidence.join(', ') : undefined,
    }
}
