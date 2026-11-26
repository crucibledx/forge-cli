import {portablePath} from '../portable-path'
import {isGlobalMode} from '../scope'
import type {HarnessDefinition} from './types'

export const harnessesRegistry: HarnessDefinition[] = []

export function getAllHarnesses(): readonly HarnessDefinition[] {
  return harnessesRegistry
}

export function getHarness(id: string): HarnessDefinition {
  const harness = harnessesRegistry.find((a) => a.id === id)
  if (!harness) {
    throw new Error(`Unknown harness: ${id}`)
  }
  return harness
}

export function getHarnessIds(): string[] {
  return harnessesRegistry.map((a) => a.id)
}

/**
 * Derives the harness ID from a target file path by matching against
 * registered targetMappings destinations.
 */
export function resolveHarnessByPath(targetPath: string): HarnessDefinition | undefined {
  const path = portablePath(targetPath)
  const owners = harnessesRegistry.filter((harness) =>
    harness.targetMappings.some((mapping) => {
      const destination = portablePath(
        isGlobalMode() ? (mapping.destination.global ?? mapping.destination.project) : mapping.destination.project,
      )
      return path.startsWith(`${destination}/`)
    }),
  )
  return owners.length === 1 ? owners[0] : undefined
}
