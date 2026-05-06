import {existsSync, readdirSync} from 'node:fs'
import {join} from 'node:path'

import type {AssistantDefinition, DetectionResult} from '@domain/assistants/types'

export async function scanForAssistants(
    projectRoot: string,
    assistants: readonly AssistantDefinition[],
): Promise<DetectionResult[]> {
    const results: DetectionResult[] = []

    for (const assistant of assistants) {
        const result = await detectAssistant(projectRoot, assistant)
        results.push(result)
    }

    return results
}

async function detectAssistant(
    projectRoot: string,
    assistant: AssistantDefinition,
): Promise<DetectionResult> {
    const evidenceByDirectories = assistant.detection.directories
        .map(dir => ({dir, fullPath: join(projectRoot, dir)}))
        .filter(({fullPath}) => existsSync(fullPath))
        .map(({dir, fullPath}) => {
            try {
                const entries = readdirSync(fullPath)
                const fileCount = entries.filter((e) => !e.startsWith('.')).length
                return fileCount > 0
                    ? `${dir}/ found (${fileCount} items)`
                    : `${dir}/ found (empty)`
            } catch {
                return `${dir}/ found`
            }
        })

    const evidenceByFiles = assistant.detection.files
        .map(file => ({file, fullPath: join(projectRoot, file)}))
        .filter(({fullPath}) => existsSync(fullPath))
        .map(({file}) => `${file} found`)

    const evidence = [...evidenceByDirectories, ...evidenceByFiles]

    return {
        id: assistant.id,
        name: assistant.name,
        detected: evidence.length > 0,
        evidence: evidence.length > 0 ? evidence.join(', ') : undefined,
    }
}
