import {z} from 'zod'

import {PLUGIN_HARNESS_IDS} from '@domain/plugins'

/** Spec 0005 §2. Parsed as written; sync applies COMPILE_CONFIG_DEFAULTS. Later issues consume the later passes' keys. */
const budget = z.union([z.number().int().positive(), z.literal('off')])
const cap = z.number().int().positive()
const harnessOverrideSchema = z
  .object({
    skills: budget.optional(),
    agents: budget.optional(),
    commands: budget.optional(),
    skill_description: cap.optional(),
    agent_description: cap.optional(),
  })
  .strict()
const guardianSchema = z.union([
  z.literal('off'),
  z
    .object({
      hook: z.enum(['auto', 'on', 'off']).optional(),
      mcp: z.enum(['auto', 'on', 'off']).optional(),
      min_score: z.number().optional(),
    })
    .strict(),
])
const profileSchema = z.union([
  z.literal(false),
  z.enum(['rank', 'prune']),
  z
    .object({
      mode: z.enum(['rank', 'prune']),
      include: z.array(z.string()).optional(),
      exclude: z.array(z.string()).optional(),
    })
    .strict(),
])

export const compileConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    priority: z.array(z.string()).optional(),
    keep: z.array(z.string()).optional(),
    defer: z.array(z.string()).optional(),
    profile: profileSchema.optional(),
    guardian: guardianSchema.optional(),
    harnesses: z.partialRecord(z.enum(PLUGIN_HARNESS_IDS as [string, ...string[]]), harnessOverrideSchema).optional(),
  })
  .strict()
