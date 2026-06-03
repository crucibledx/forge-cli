import {z} from 'zod'

import {getAssistantIds} from '@domain/assistants'
import type {LocalConflictStrategy, SourceConflictStrategy} from '@domain/config/types'
import {LOCAL_CONFLICT_STRATEGIES, SOURCE_CONFLICT_STRATEGIES} from '@domain/config/types'
import {sourceConfigSchema} from '@infrastructure/source'

const sourceConflictValues = Object.values(SOURCE_CONFLICT_STRATEGIES) as [
  SourceConflictStrategy,
  ...SourceConflictStrategy[],
]
const localConflictValues = Object.values(LOCAL_CONFLICT_STRATEGIES) as [
  LocalConflictStrategy,
  ...LocalConflictStrategy[],
]

const assistantIdSchema = z.enum(getAssistantIds() as [string, ...string[]])

const assistantConfigSchema = z.object({
  id: assistantIdSchema,
  enabled: z.boolean(),
  config: z.record(z.string(), z.unknown()).optional(),
})

const syncConfigSchema = z
  .object({
    source_conflict_strategy: z.enum(sourceConflictValues).optional(),
    local_conflict_strategy: z.enum(localConflictValues).optional(),
    backup: z.boolean().optional(),
    keep_local: z.boolean().optional(),
    schedule: z.string().optional(),
  })
  .optional()

export const projectConfigSchema = z
  .object({
    version: z.string(),
    project: z
      .object({
        name: z.string(),
        description: z.string().optional(),
      })
      .optional(),
    assistants: z.array(assistantConfigSchema),
    source: sourceConfigSchema.optional(),
    sources: z.array(sourceConfigSchema).optional(),
    sync: syncConfigSchema,
    lastSync: z.string().optional(),
  })
  .transform(({source, sources, ...rest}) => ({
    ...rest,
    sources: sources ?? (source ? [source] : []),
  }))

export const globalConfigSchema = projectConfigSchema
