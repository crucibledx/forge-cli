import {claudeCode} from './claude-code'
import {cline} from './cline'
import {copilot} from './copilot'
import {cursor} from './cursor'
import type {AssistantDefinition, AssistantId} from './types'
import {windsurf} from './windsurf'

const ALL_ASSISTANTS: readonly AssistantDefinition[] = [claudeCode, cursor, windsurf, copilot, cline]

const ASSISTANT_REGISTRY: Record<string, AssistantDefinition> = Object.fromEntries(ALL_ASSISTANTS.map((a) => [a.id, a]))

export function getAllAssistants(): readonly AssistantDefinition[] {
  return ALL_ASSISTANTS
}

export function getAssistant(id: AssistantId): AssistantDefinition {
  const assistant = ASSISTANT_REGISTRY[id]
  if (!assistant) {
    throw new Error(`Unknown assistant: ${id}`)
  }
  return assistant
}
