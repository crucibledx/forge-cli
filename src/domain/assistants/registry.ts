import {portablePath} from '../portable-path'
import {isGlobalMode} from '../scope'
import type {AssistantDefinition} from './types'

export const assistantsRegistry: AssistantDefinition[] = []

export function getAllAssistants(): readonly AssistantDefinition[] {
  return assistantsRegistry
}

export function getAssistant(id: string): AssistantDefinition {
  const assistant = assistantsRegistry.find((a) => a.id === id)
  if (!assistant) {
    throw new Error(`Unknown assistant: ${id}`)
  }
  return assistant
}

export function getAssistantIds(): string[] {
  return assistantsRegistry.map((a) => a.id)
}

/**
 * Derives the assistant ID from a target file path by matching against
 * registered targetMappings destinations.
 */
export function resolveAssistantByPath(targetPath: string): AssistantDefinition | undefined {
  const path = portablePath(targetPath)
  const owners = assistantsRegistry.filter((assistant) =>
    assistant.targetMappings.some((mapping) => {
      const destination = portablePath(
        isGlobalMode() ? (mapping.destination.global ?? mapping.destination.project) : mapping.destination.project,
      )
      return path.startsWith(`${destination}/`)
    }),
  )
  return owners.length === 1 ? owners[0] : undefined
}
