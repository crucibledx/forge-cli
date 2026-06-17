import type {Source} from '../config/types'
import type {SourceFile} from './types'

/**
 * Apply source-level include/exclude/map transformations to source files.
 * Runs between source loading and target resolution.
 *
 * Order: include → exclude → map
 */
export function applySourceFilters(files: SourceFile[], source: Source): SourceFile[] {
  let result = files

  if (source.include?.length) {
    result = filterInclude(result, source.include)
  }

  if (source.exclude?.length) {
    result = filterExclude(result, source.exclude)
  }

  if (source.map) {
    result = mapSourceFiles(result, source.map)
  }

  return result
}

/**
 * Keep only files matching at least one include pattern.
 */
export function filterInclude(files: SourceFile[], patterns: string[]): SourceFile[] {
  const matchers = patterns.map((p) => new Bun.Glob(p))
  return files.filter((f) => matchers.some((m) => m.match(f.relativePath)))
}

/**
 * Remove files matching any exclude pattern.
 */
export function filterExclude(files: SourceFile[], patterns: string[]): SourceFile[] {
  const matchers = patterns.map((p) => new Bun.Glob(p))
  return files.filter((f) => !matchers.some((m) => m.match(f.relativePath)))
}

/**
 * Prepend a virtual directory prefix to all file paths.
 * e.g. map: "skills" turns "SKILL.md" into "skills/SKILL.md"
 * so the canonical resolver can pick it up.
 */
export function mapSourceFiles(files: SourceFile[], prefix: string): SourceFile[] {
  const normalized = prefix.endsWith('/') ? prefix : `${prefix}/`
  return files.map((f) => ({
    ...f,
    relativePath: `${normalized}${f.relativePath}`,
  }))
}
