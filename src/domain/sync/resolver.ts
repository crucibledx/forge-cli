import {join, sep} from 'node:path'

import type {HarnessDefinition, TargetDestination, TargetMapping} from '../harnesses/types'
import {isGlobalMode} from '../scope'
import {getTransformer} from '../transforms/registry'
import type {TransformContext} from '../transforms/types'
import {
  detectSourceLayout,
  partitionByLayout,
  SOURCE_LAYOUT_OPTIONS,
  SOURCE_LAYOUTS,
  type SourceLayout,
  type SourceLayoutOption,
} from './layout'
import type {ResolvedTarget, SourceFile} from './types'

type ResolverFn = (
  sourceFiles: SourceFile[],
  harnesses: readonly HarnessDefinition[],
  sourceName: string,
) => ResolvedTarget[]

const resolvers: Record<SourceLayout, ResolverFn> = {
  [SOURCE_LAYOUTS.CANONICAL]: resolveCanonical,
  [SOURCE_LAYOUTS.PRE_STRUCTURED]: resolvePreStructured,
  [SOURCE_LAYOUTS.HYBRID]: resolveHybrid,
}

/**
 * Resolves source files to target paths. Auto-detects layout and dispatches
 * to the appropriate resolver - canonical (with transforms), pre-structured
 * (passthrough), or hybrid (partition + resolve each group).
 *
 * In global mode, uses `global` destination when defined, otherwise falls back to `project`.
 */
export function resolveTargets(
  sourceFiles: SourceFile[],
  harnesses: readonly HarnessDefinition[],
  sourceName = '',
  layoutOverride?: SourceLayoutOption,
): ResolvedTarget[] {
  const layout =
    layoutOverride && layoutOverride !== SOURCE_LAYOUT_OPTIONS.AUTO
      ? (layoutOverride as SourceLayout)
      : detectSourceLayout(sourceFiles)
  const resolved = resolvers[layout](sourceFiles, harnesses, sourceName)
  for (const target of resolved)
    if (target.targetPath.includes('\\'))
      throw new Error(`Backslash in source filename is not portable: ${target.sourcePath}; use real directories`)
  return resolved
}

/**
 * Hybrid sources contain both harness-specific dirs and canonical files.
 * Partition files, resolve each group with its resolver, merge results.
 */
function resolveHybrid(
  sourceFiles: SourceFile[],
  harnesses: readonly HarnessDefinition[],
  sourceName: string,
): ResolvedTarget[] {
  const {preStructured, canonical} = partitionByLayout(sourceFiles)
  const preResults = resolvePreStructured(preStructured, harnesses, sourceName)
  const preTargetPaths = new Set(preResults.map((r) => r.targetPath))
  const canonicalResults = resolveCanonical(canonical, harnesses, sourceName)
  return [...preResults, ...canonicalResults.filter((r) => !preTargetPaths.has(r.targetPath))]
}

/**
 * For pre-structured sources, files are matched against harness destination
 * prefixes. In project mode the path is kept as-is; in global mode the project
 * prefix is swapped for the global destination (falling back to project).
 */
function resolvePreStructured(
  sourceFiles: SourceFile[],
  harnesses: readonly HarnessDefinition[],
  sourceName: string,
): ResolvedTarget[] {
  const prefixEntries = harnesses.flatMap((a) =>
    a.targetMappings.map((m) => ({
      prefix: m.destination.project,
      dest: resolveDestination(m.destination),
      harnessId: a.id,
    })),
  )

  const resolved: ResolvedTarget[] = []

  for (const file of sourceFiles) {
    const match = prefixEntries.find((e) => file.relativePath.startsWith(e.prefix))
    if (!match) continue

    const relativePart = file.relativePath.slice(match.prefix.length)
    const targetPath = join(match.dest, relativePart).split(sep).join('/')

    resolved.push({
      sourcePath: file.relativePath,
      targetPath,
      content: file.content,
      harnessId: match.harnessId,
      sourceName,
    })
  }

  return resolved
}

function resolveCanonical(
  sourceFiles: SourceFile[],
  harnesses: readonly HarnessDefinition[],
  sourceName: string,
): ResolvedTarget[] {
  const resolved: ResolvedTarget[] = []

  for (const harness of harnesses) {
    for (const mapping of harness.targetMappings) {
      const dest = resolveDestination(mapping.destination)

      for (const file of sourceFiles) {
        const match = matchGlob(file.relativePath, mapping.sourceGlob)
        if (!match.matches) continue

        const {filename, content} = applyTransforms(match.relativePath, file.content, mapping)
        const targetPath = join(dest, filename).split(sep).join('/')

        resolved.push({
          sourcePath: file.relativePath,
          targetPath,
          content,
          harnessId: harness.id,
          sourceName,
        })
      }
    }
  }

  return resolved
}

function matchGlob(filePath: string, glob: string): {matches: boolean; relativePath: string} {
  const matcher = new Bun.Glob(glob)
  if (!matcher.match(filePath)) return {matches: false, relativePath: ''}

  // Extract prefix directory from glob for relativePath calculation
  const prefixEnd = glob.indexOf('*')
  const prefix = prefixEnd > 0 ? glob.slice(0, prefixEnd) : ''
  const relativePath = prefix && filePath.startsWith(prefix) ? filePath.slice(prefix.length) : filePath
  return {matches: true, relativePath}
}

function resolveDestination(dest: TargetDestination): string {
  if (isGlobalMode()) return dest.global ?? dest.project
  return dest.project
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
