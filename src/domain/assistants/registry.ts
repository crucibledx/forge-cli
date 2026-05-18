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
