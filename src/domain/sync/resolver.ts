import {join} from 'node:path'

import type {AssistantDefinition, TargetMapping} from '../assistants/types'
import {getTransformer} from '../transforms/registry'
import type {TransformContext} from '../transforms/types'
import type {ResolvedTarget, SourceFile} from './types'

export function resolveTargets(
  sourceFiles: SourceFile[],
  assistants: readonly AssistantDefinition[],
  sourceName = '',
): ResolvedTarget[] {
  const resolved: ResolvedTarget[] = []

  for (const assistant of assistants) {
    for (const mapping of assistant.targetMappings) {
      for (const file of sourceFiles) {
        const match = matchGlob(file.relativePath, mapping.sourceGlob)
        if (!match.matches) continue

        const {filename, content} = applyTransforms(match.relativePath, file.content, mapping)
        const targetPath = join(mapping.destination, filename)

        resolved.push({
          sourcePath: file.relativePath,
          targetPath,
          content,
          assistantId: assistant.id,
          sourceName,
        })
      }
    }
  }

  return resolved
}

function matchGlob(filePath: string, glob: string): {matches: boolean; relativePath: string} {
  // Simple prefix matching: "skills/**" matches "skills/anything"
  const prefix = glob.replace('/**', '/')
  if (filePath.startsWith(prefix)) {
    return {matches: true, relativePath: filePath.slice(prefix.length)}
  }
  return {matches: false, relativePath: ''}
}

function applyTransforms(filename: string, content: string, mapping: TargetMapping): TransformContext {
  if (!mapping.transforms?.length) return {filename, content}

  return mapping.transforms.reduce<TransformContext>(
    (ctx, step) => {
      const transformer = getTransformer(step.transformer)
      return transformer ? transformer.apply(ctx, step.params) : ctx
    },
    {filename, content},
  )
}
