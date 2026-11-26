import {z} from 'zod'

import {getHarnessIds} from '@domain/harnesses'
import type {LocalConflictStrategy, SourceConflictStrategy} from '@domain/config/types'
import {LOCAL_CONFLICT_STRATEGIES, SOURCE_CONFLICT_STRATEGIES} from '@domain/config/types'
import {isValidCron} from '@domain/scheduler'
import {sourceConfigSchema} from '@infrastructure/source'

const sourceConflictValues = Object.values(SOURCE_CONFLICT_STRATEGIES) as [
  SourceConflictStrategy,
  ...SourceConflictStrategy[],
]
const localConflictValues = Object.values(LOCAL_CONFLICT_STRATEGIES) as [
  LocalConflictStrategy,
  ...LocalConflictStrategy[],
]

export const HARNESS_KEY_MESSAGES = {
  both: 'Config has both `harnesses:` and `assistants:`. Keep one: `assistants:` is the old name of `harnesses:`.',
  missing: 'Config needs a `harnesses:` list.',
}

const harnessIdSchema = z.enum(getHarnessIds() as [string, ...string[]])

const harnessConfigSchema = z.object({
  id: harnessIdSchema,
  enabled: z.boolean(),
  config: z.record(z.string(), z.unknown()).optional(),
})

const syncConfigSchema = z
  .object({
    source_conflict_strategy: z.enum(sourceConflictValues).optional(),
    local_conflict_strategy: z.enum(localConflictValues).optional(),
    backup: z.boolean().optional(),
    keep_local: z.boolean().optional(),
    schedule: z
      .string()
      .refine((v) => isValidCron(v), {message: 'Invalid cron expression'})
      .optional(),
  })
  .optional()

const telemetryConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    backend: z.string().optional(),
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
    harnesses: z.array(harnessConfigSchema).optional(),
    // Read alias for configs written before the harness rename; removed at v1.0.
    assistants: z.array(harnessConfigSchema).optional(),
    source: sourceConfigSchema.optional(),
    sources: z.array(sourceConfigSchema).optional(),
    sync: syncConfigSchema,
    telemetry: telemetryConfigSchema,
    lastSync: z.string().optional(),
  })
  .superRefine((config, ctx) => {
    if (config.harnesses && config.assistants)
      ctx.addIssue({code: 'custom', path: ['assistants'], message: HARNESS_KEY_MESSAGES.both})
    else if (!config.harnesses && !config.assistants)
      ctx.addIssue({code: 'custom', path: ['harnesses'], message: HARNESS_KEY_MESSAGES.missing})
  })
  .transform(({source, sources, assistants, harnesses, ...rest}) => ({
    ...rest,
    harnesses: harnesses ?? assistants ?? [],
    sources: sources ?? (source ? [source] : []),
  }))

export const globalConfigSchema = projectConfigSchema
