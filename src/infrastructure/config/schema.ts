import {z} from 'zod'

import {getAssistantIds} from '@domain/assistants'
import {sourceConfigSchema} from '@infrastructure/source'

const assistantIdSchema = z.enum(getAssistantIds() as [string, ...string[]])

const assistantConfigSchema = z.object({
  id: assistantIdSchema,
  enabled: z.boolean(),
  config: z.record(z.string(), z.unknown()).optional(),
})

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
    lastSync: z.string().optional(),
  })
  .transform(({source, sources, ...rest}) => ({
    ...rest,
    sources: sources ?? (source ? [source] : []),
  }))

export const globalConfigSchema = projectConfigSchema
