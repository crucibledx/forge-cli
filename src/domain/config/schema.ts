import {z} from 'zod'

import {ASSISTANT_IDS} from '../assistants/types'

const assistantIdSchema = z.enum(ASSISTANT_IDS)

const assistantConfigSchema = z.object({
  id: assistantIdSchema,
  enabled: z.boolean(),
  config: z.record(z.string(), z.unknown()).optional(),
})

const gitAuthSchema = z.object({
  type: z.enum(['ssh-key', 'token']),
  keyPath: z.string().optional(),
  token: z.string().optional(),
})

const gitSourceSchema = z.object({
  name: z.string(),
  type: z.literal('git'),
  url: z.string(),
  branch: z.string().default('main'),
  path: z.string().optional(),
  auth: gitAuthSchema.optional(),
})

const localSourceSchema = z.object({
  name: z.string(),
  type: z.literal('local'),
  path: z.string(),
})

const sourceSchema = z.discriminatedUnion('type', [gitSourceSchema, localSourceSchema])

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
    source: sourceSchema.optional(),
    sources: z.array(sourceSchema).optional(),
    lastSync: z.string().optional(),
  })
  .transform(({source, sources, ...rest}) => ({
    ...rest,
    sources: sources ?? (source ? [source] : []),
  }))

export const globalConfigSchema = z.object({
  version: z.string(),
  user: z
    .object({
      name: z.string(),
    })
    .optional(),
  defaults: z
    .object({
      assistants: z.array(assistantConfigSchema).optional(),
      source: sourceSchema.optional(),
      sources: z.array(sourceSchema).optional(),
    })
    .transform(({source, sources, ...rest}) => ({
      ...rest,
      sources: sources ?? (source ? [source] : undefined),
    }))
    .optional(),
})
