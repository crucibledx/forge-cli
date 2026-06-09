import {getAllAssistants} from '../assistants/registry'
import type {SourceFile} from './types'

export const SOURCE_LAYOUTS = {
  CANONICAL: 'canonical',
  PRE_STRUCTURED: 'pre-structured',
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
 * Detect whether source files follow a canonical or pre-structured layout.
 * Pre-structured: top-level directories match known assistant dirs (.claude/, .cursor/, etc.)
 */
export function detectSourceLayout(files: SourceFile[]): SourceLayout {
  const assistantDirs = new Set(Object.keys(getAssistantDirMap()))

  for (const file of files) {
    const topDir = file.relativePath.split('/')[0]
    if (assistantDirs.has(topDir)) {
      return SOURCE_LAYOUTS.PRE_STRUCTURED
    }
  }

  return SOURCE_LAYOUTS.CANONICAL
}
