import type {ComponentKind, HarnessDefinition} from './types'
import {COMPONENT_KINDS as K} from './types'

/** The v0.7 canonical source folders and the component kind each one delivers. */
export const SOURCE_GLOB_KINDS: Readonly<Record<string, ComponentKind>> = {
  'skills/**': K.SKILL,
  'rules/**': K.RULE,
  'workflows/**': K.COMMAND,
}

export interface UndeliveredSource {
  harnessId: string
  sourceGlob: string
}

/** Canonical source folders that have files but no mapping for a harness, so sync delivers nothing there. */
export function findUndelivered(
  sourcePaths: readonly string[],
  harnesses: readonly HarnessDefinition[],
): UndeliveredSource[] {
  const present = Object.keys(SOURCE_GLOB_KINDS).filter((glob) => {
    const matcher = new Bun.Glob(glob)
    return sourcePaths.some((path) => matcher.match(path))
  })
  return harnesses.flatMap((harness) =>
    present
      .filter((glob) => !harness.targetMappings.some((mapping) => mapping.sourceGlob === glob))
      .map((sourceGlob) => ({harnessId: harness.id, sourceGlob})),
  )
}
