import {join} from 'node:path'

import type {AssistantDefinition} from '../assistants/types'
import type {ResolvedTarget, SourceFile} from './types'

export function resolveTargets(
    sourceFiles: SourceFile[],
    assistants: readonly AssistantDefinition[],
): ResolvedTarget[] {
    const resolved: ResolvedTarget[] = []

    for (const assistant of assistants) {
        for (const mapping of assistant.targetMappings) {
            for (const file of sourceFiles) {
                const match = matchGlob(file.relativePath, mapping.sourceGlob)
                if (!match.matches) continue

                const filename = applyTransform(match.relativePath, mapping.transform)
                const targetPath = join(mapping.destination, filename)

                resolved.push({
                    sourcePath: file.relativePath,
                    targetPath,
                    content: file.content,
                    assistantId: assistant.id,
                })
            }
        }
    }

    return resolved
}

function matchGlob(
    filePath: string,
    glob: string,
): {matches: boolean, relativePath: string} {
    // Simple prefix matching: "skills/**" matches "skills/anything"
    const prefix = glob.replace('/**', '/')
    if (filePath.startsWith(prefix)) {
        return {matches: true, relativePath: filePath.slice(prefix.length)}
    }
    return {matches: false, relativePath: ''}
}

type TransformHandler = (filename: string, spec: string) => string

const transformHandlers: Record<string, TransformHandler> = {
    rename: (filename, spec) => {
        const parts = spec.split('→')
        if (parts.length === 2) {
            const [from, to] = parts
            if (filename.endsWith(from)) {
                return filename.slice(0, -from.length) + to
            }
        }
        return filename
    },
}

function applyTransform(filename: string, transform?: string): string {
    if (!transform) return filename

    const colonIdx = transform.indexOf(':')
    if (colonIdx === -1) return filename

    const type = transform.slice(0, colonIdx)
    const spec = transform.slice(colonIdx + 1)

    const handler = transformHandlers[type]
    return handler ? handler(filename, spec) : filename
}
