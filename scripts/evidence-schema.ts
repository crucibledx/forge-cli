import {z} from 'zod'

import {PLATFORMS, requiredLaneIds} from './validation-lanes'

export const sha = z.string().regex(/^[a-f0-9]{40}$/)
const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/)
const nonempty = z.string().min(1).max(16000)
export const evidencePath = z
  .string()
  .min(1)
  .max(500)
  .refine(
    (path) =>
      !/^(?:[/\\]|[a-z]:)/i.test(path) &&
      !/[\\:\0]/.test(path) &&
      !path.split('/').some((segment) => !segment || segment === '.' || segment === '..'),
    'Evidence must be a safe relative artifact path',
  )
export const sourceUri = z
  .string()
  .max(1000)
  .refine((uri) => {
    if (/^factory-session:\/\/[a-f0-9-]{36}\/[a-f0-9-]{36}$/.test(uri)) return true
    try {
      const value = new URL(uri)
      return (
        value.protocol === 'https:' &&
        value.hostname === 'github.com' &&
        !value.username &&
        !value.password &&
        !value.search &&
        /^\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+\/(?:actions\/runs\/\d+(?:\/attempts\/\d+)?(?:\/job\/\d+)?|(?:issues|pull)\/\d+#issuecomment-\d+|pull\/\d+#(?:pullrequestreview-|discussion_r)\d+)$/.test(
          value.pathname + value.hash,
        )
      )
    } catch {
      return false
    }
  }, 'Unsupported or credentialed evidence URI')
export const evidenceRef = z.union([evidencePath, sourceUri])
const evidence = z.array(evidenceRef).min(1)
const unique = (items: string[]) => new Set(items).size === items.length
export const contextSchema = z
  .object({
    schema_version: z.literal(1),
    kind: z.enum(['pr', 'local']),
    repository: z.string().regex(/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/),
    pr_number: z.number().int().positive().optional(),
    head_sha: sha,
    tested_sha: sha,
    base_sha: sha.optional(),
    run_id: id,
    run_attempt: z.number().int().positive(),
    workflow_ref: nonempty.optional(),
    required_lane_ids: z
      .array(z.string())
      .refine(
        (ids) =>
          unique(ids) && ids.length === requiredLaneIds.length && requiredLaneIds.every((id) => ids.includes(id)),
        'Required lane set differs from registry',
      ),
  })
  .strict()
  .superRefine((context, ctx) => {
    if (context.kind === 'local' && (context.pr_number !== undefined || context.head_sha !== context.tested_sha))
      ctx.addIssue({code: 'custom', message: 'Local context cannot impersonate PR merge validation'})
    if (
      context.kind === 'pr' &&
      (!context.pr_number || !context.base_sha || !context.workflow_ref || !/^\d+$/.test(context.run_id))
    )
      ctx.addIssue({code: 'custom', message: 'PR context requires event-bound PR/base/workflow/run identity'})
  })
export type EvidenceContext = z.infer<typeof contextSchema>
export const checkSchema = z
  .object({
    id: nonempty,
    command: nonempty,
    exit_code: z.number().int().nullable(),
    duration_ms: z.number().nonnegative().finite(),
    evidence,
    reason: nonempty.optional(),
  })
  .strict()
export const laneSchema = z
  .object({
    schema_version: z.literal(1),
    head_sha: sha,
    tested_sha: sha,
    run_id: id,
    run_attempt: z.number().int().positive(),
    lane_id: z.string().refine((value) => requiredLaneIds.includes(value)),
    status: z.enum(['pass', 'fail', 'blocked', 'cancelled']),
    runner_os: z.enum(PLATFORMS),
    bun_version: z.string().regex(/^\d+\.\d+\.\d+$/),
    duration_ms: z.number().nonnegative().finite(),
    checks: z
      .array(checkSchema)
      .min(1)
      .refine((checks) => unique(checks.map((check) => check.id)), 'Duplicate check IDs'),
  })
  .strict()
export type LaneEvidence = z.infer<typeof laneSchema>
