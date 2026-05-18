import './claude-code'
import './cline'
import './copilot'
import './cursor'
import './windsurf'

export {assistantsRegistry, getAllAssistants, getAssistant, getAssistantIds} from './registry'
export type {
  AssistantConfig,
  AssistantDefinition,
  AssistantId,
  DetectionResult,
  DetectionRule,
  TargetMapping,
} from './types'
