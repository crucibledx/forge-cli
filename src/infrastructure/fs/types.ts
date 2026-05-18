import type {AssistantDefinition, DetectionResult} from '@domain/assistants/types'
import type {Mutation, SourceFile} from '@domain/sync/types'

import type {AppliedMutation} from './mutations'

export interface FsService {
  collectFiles: (baseDir: string) => Promise<SourceFile[]>
  scanForAssistants: (projectRoot: string, assistants: readonly AssistantDefinition[]) => Promise<DetectionResult[]>
  applyMutations: (projectRoot: string, mutations: Mutation[]) => Promise<AppliedMutation[]>
  rollbackMutations: (projectRoot: string, applied: AppliedMutation[]) => Promise<void>
}
