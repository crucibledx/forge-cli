import {join} from 'node:path'

import type {AssistantDefinition, TargetMapping} from '../assistants/types'
import {getTransformer} from '../transforms/registry'
import type {TransformContext} from '../transforms/types'
import {detectSourceLayout, getAssistantDirMap, partitionByLayout, SOURCE_LAYOUTS, type SourceLayout} from './layout'
import type {ResolvedTarget, SourceFile} from './types'

type ResolverFn = (
  sourceFiles: SourceFile[],
  assistants: readonly AssistantDefinition[],
  sourceName: string,
) => ResolvedTarget[]

const resolvers: Record<SourceLayout, ResolverFn> = {
  [SOURCE_LAYOUTS.CANONICAL]: resolveCanonical,
  [SOURCE_LAYOUTS.PRE_STRUCTURED]: resolvePreStructured,
  [SOURCE_LAYOUTS.HYBRID]: resolveHybrid,
}

/**
 * Resolves source files to target paths. Auto-detects layout and dispatches
 * to the appropriate resolver — canonical (with transforms), pre-structured
 * (passthrough), or hybrid (partition + resolve each group).
 */
export function resolveTargets(
  sourceFiles: SourceFile[],
  assistants: readonly AssistantDefinition[],
  sourceName = '',
): ResolvedTarget[] {
  const layout = detectSourceLayout(sourceFiles)
  return resolvers[layout](sourceFiles, assistants, sourceName)
}

/**
 * Hybrid sources contain both assistant-specific dirs and canonical files.
 * Partition files, resolve each group with its resolver, merge results.
 */
function resolveHybrid(
  sourceFiles: SourceFile[],
  assistants: readonly AssistantDefinition[],
  sourceName: string,
): ResolvedTarget[] {
  const {preStructured, canonical} = partitionByLayout(sourceFiles)
  const preResults = resolvePreStructured(preStructured, assistants, sourceName)
  const preTargetPaths = new Set(preResults.map((r) => r.targetPath))
  const canonicalResults = resolveCanonical(canonical, assistants, sourceName)
  return [...preResults, ...canonicalResults.filter((r) => !preTargetPaths.has(r.targetPath))]
}

/**
 * For pre-structured sources, files are copied as-is to the project root.
 * The relativePath in the source IS the targetPath.
 * Only files belonging to enabled assistants are included.
 */
function resolvePreStructured(
  sourceFiles: SourceFile[],
  assistants: readonly AssistantDefinition[],
  sourceName: string,
): ResolvedTarget[] {
  const assistantDirMap = getAssistantDirMap()
  const enabledIds = new Set(assistants.map((a) => a.id))
  const resolved: ResolvedTarget[] = []

  for (const file of sourceFiles) {
    const topDir = file.relativePath.split('/')[0]
    const assistantId = assistantDirMap[topDir]

    if (!assistantId || !enabledIds.has(assistantId)) continue

    resolved.push({
      sourcePath: file.relativePath,
      targetPath: file.relativePath,
      content: file.content,
      assistantId,
      sourceName,
    })
  }

  return resolved
}

function resolveCanonical(
  sourceFiles: SourceFile[],
  assistants: readonly AssistantDefinition[],
  sourceName: string,
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
