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

/** The single harness with a mapped destination matching `owns`, or undefined when none or several match. */
function resolveOwner(owns: (destination: string) => boolean): HarnessDefinition | undefined {
  const owners = harnessesRegistry.filter((harness) =>
    harness.targetMappings.some(({destination}) =>
      owns(portablePath(isGlobalMode() ? (destination.global ?? destination.project) : destination.project)),
    ),
  )
  return owners.length === 1 ? owners[0] : undefined
}

/**
 * Derives the harness ID from a target file path by matching against
 * registered targetMappings destinations.
 */
export function resolveHarnessByPath(targetPath: string): HarnessDefinition | undefined {
  const path = portablePath(targetPath)
  return resolveOwner((destination) => path.startsWith(`${destination}/`))
}

/**
 * A harness's settings file sits in the folder that holds its mapped targets, e.g. `.claude/settings.local.json`
 * beside `.claude/skills/`, so ownership comes from that folder; a root-level or shared folder has no owner.
 */
export function resolveHarnessBySettingsPath(settingsPath: string): HarnessDefinition | undefined {
  const folder = portablePath(settingsPath).split('/').slice(0, -1).join('/')
  return folder ? resolveOwner((destination) => destination.startsWith(`${folder}/`)) : undefined
}
