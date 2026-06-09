import {getAllAssistants} from '../assistants/registry'
import type {SourceFile} from './types'

export const SOURCE_LAYOUTS = {
  CANONICAL: 'canonical',
  PRE_STRUCTURED: 'pre-structured',
  HYBRID: 'hybrid',
} as const

export type SourceLayout = (typeof SOURCE_LAYOUTS)[keyof typeof SOURCE_LAYOUTS]

/**
 * Known assistant directories that signal a pre-structured source.
 * Maps directory name → assistant id.
 */
export function getAssistantDirMap(): Record<string, string> {
  const map: Record<string, string> = {}
  for (const assistant of getAllAssistants()) {
    for (const mapping of assistant.targetMappings) {
      // Extract top-level dir from destination, e.g. ".claude/rules/" → ".claude"
      const topDir = mapping.destination.split('/')[0]
      if (topDir && !map[topDir]) {
        map[topDir] = assistant.id
      }
    }
  }
  return map
}

/**
 * Detect whether source files follow a canonical, pre-structured, or hybrid layout.
 * Hybrid: source contains both assistant-specific dirs and canonical files.
 */
export function detectSourceLayout(files: SourceFile[]): SourceLayout {
  const assistantDirs = new Set(Object.keys(getAssistantDirMap()))
  let hasPreStructured = false
  let hasCanonical = false

  for (const file of files) {
    const topDir = file.relativePath.split('/')[0]
    if (assistantDirs.has(topDir)) {
      hasPreStructured = true
    } else {
      hasCanonical = true
    }
    if (hasPreStructured && hasCanonical) return SOURCE_LAYOUTS.HYBRID
  }

  return hasPreStructured ? SOURCE_LAYOUTS.PRE_STRUCTURED : SOURCE_LAYOUTS.CANONICAL
}

/**
 * Partition source files into pre-structured (assistant-dir top-level) and canonical (everything else).
 */
export function partitionByLayout(files: SourceFile[]): {preStructured: SourceFile[]; canonical: SourceFile[]} {
  const assistantDirs = new Set(Object.keys(getAssistantDirMap()))
  const preStructured: SourceFile[] = []
  const canonical: SourceFile[] = []

  for (const file of files) {
    const topDir = file.relativePath.split('/')[0]
    if (assistantDirs.has(topDir)) {
      preStructured.push(file)
    } else {
      canonical.push(file)
    }
  }

  return {preStructured, canonical}
}
