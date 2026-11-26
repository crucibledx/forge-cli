import {getAllHarnesses} from '../harnesses/registry'
import type {SourceFile} from './types'

export const SOURCE_LAYOUTS = {
  CANONICAL: 'canonical',
  PRE_STRUCTURED: 'pre-structured',
  HYBRID: 'hybrid',
} as const

export type SourceLayout = (typeof SOURCE_LAYOUTS)[keyof typeof SOURCE_LAYOUTS]

export const SOURCE_LAYOUT_OPTIONS = {
  AUTO: 'auto',
  CANONICAL: SOURCE_LAYOUTS.CANONICAL,
  PRE_STRUCTURED: SOURCE_LAYOUTS.PRE_STRUCTURED,
} as const

export type SourceLayoutOption = (typeof SOURCE_LAYOUT_OPTIONS)[keyof typeof SOURCE_LAYOUT_OPTIONS]

export const SOURCE_LAYOUT_VALUES = Object.values(SOURCE_LAYOUT_OPTIONS) as [
  SourceLayoutOption,
  ...SourceLayoutOption[],
]

/**
 * Known harness directories that signal a pre-structured source.
 * Maps directory name → harness id.
 */
export function getHarnessDirMap(): Record<string, string> {
  const map: Record<string, string> = {}
  for (const harness of getAllHarnesses()) {
    for (const mapping of harness.targetMappings) {
      // Extract top-level dir from project destination, e.g. ".claude/rules/" → ".claude"
      const topDir = mapping.destination.project.split('/')[0]
      if (topDir && !map[topDir]) {
        map[topDir] = harness.id
      }
    }
  }
  return map
}

/**
 * Detect whether source files follow a canonical, pre-structured, or hybrid layout.
 * Hybrid: source contains both harness-specific dirs and canonical files.
 */
export function detectSourceLayout(files: SourceFile[]): SourceLayout {
  const harnessDirs = new Set(Object.keys(getHarnessDirMap()))
  let hasPreStructured = false
  let hasCanonical = false

  for (const file of files) {
    const topDir = file.relativePath.split('/')[0]
    if (harnessDirs.has(topDir)) {
      hasPreStructured = true
    } else {
      hasCanonical = true
    }
    if (hasPreStructured && hasCanonical) return SOURCE_LAYOUTS.HYBRID
  }

  return hasPreStructured ? SOURCE_LAYOUTS.PRE_STRUCTURED : SOURCE_LAYOUTS.CANONICAL
}

/**
 * Partition source files into pre-structured (harness-dir top-level) and canonical (everything else).
 */
export function partitionByLayout(files: SourceFile[]): {preStructured: SourceFile[]; canonical: SourceFile[]} {
  const harnessDirs = new Set(Object.keys(getHarnessDirMap()))
  const preStructured: SourceFile[] = []
  const canonical: SourceFile[] = []

  for (const file of files) {
    const topDir = file.relativePath.split('/')[0]
    if (harnessDirs.has(topDir)) {
      preStructured.push(file)
    } else {
      canonical.push(file)
    }
  }

  return {preStructured, canonical}
}
