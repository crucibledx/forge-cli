import {z} from 'zod'

import {acceptanceIds, requiredLaneIds} from './validation-lanes'

export const sha = z.string().regex(/^[a-f0-9]{40}$/)
export const digest = z.string().regex(/^[a-f0-9]{64}$/)
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
        /^\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+\/(?:actions\/runs\/\d+(?:\/attempts\/\d+)?(?:\/job\/\d+)?|issues\/\d+#issuecomment-\d+|pull\/\d+#(?:pullrequestreview|discussion_r)\d+)$/.test(
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
    runner_os: z.enum(['linux', 'darwin', 'win32']),
    bun_version: z.string().regex(/^\d+\.\d+\.\d+$/),
    duration_ms: z.number().nonnegative().finite(),
    checks: z
      .array(checkSchema)
      .min(1)
      .refine((checks) => unique(checks.map((check) => check.id)), 'Duplicate check IDs'),
  })
  .strict()
export type LaneEvidence = z.infer<typeof laneSchema>
export const provenanceSchema = z
  .object({
    producer_role: z.enum(['code', 'security', 'verifier']),
    actor: id,
    source_uri: sourceUri,
    report_sha256: digest,
    completed_at: z.iso.datetime(),
    producer_id: id,
  })
  .strict()
const findingSchema = z
  .object({
    id,
    severity: z.enum(['blocking', 'nonblocking']),
    status: z.enum(['open', 'resolved']),
    evidence,
    resolution_source_uri: sourceUri.optional(),
  })
  .strict()
export const reviewSchema = z
  .object({
    schema_version: z.literal(1),
    role: z.enum(['code', 'security']),
    head_sha: sha,
    tested_sha: sha,
    completion: z.enum(['complete', 'unavailable']),
    provenance: provenanceSchema,
    findings: z
      .array(findingSchema)
      .refine((findings) => unique(findings.map((finding) => finding.id)), 'Duplicate finding IDs'),
    remaining_risks: z.array(nonempty),
  })
  .strict()
export type ReviewEvidence = z.infer<typeof reviewSchema>
const rowSchema = z
  .object({
    ac_id: z.string().refine((id) => acceptanceIds.includes(id)),
    result: z.enum(['pass', 'fail', 'blocked']),
    command: nonempty,
    exit_code: z.number().int().nullable(),
    evidence,
  })
  .strict()
export const verifierSchema = z
  .object({
    schema_version: z.literal(1),
    phase: z.literal('implementation-checks'),
    head_sha: sha,
    tested_sha: sha,
    completion: z.enum(['complete', 'unavailable']),
    provenance: provenanceSchema,
    rows: z
      .array(rowSchema)
      .refine(
        (rows) => rows.length === acceptanceIds.length && unique(rows.map((row) => row.ac_id)),
        'Every AC must occur exactly once',
      ),
  })
  .strict()
export type VerifierEvidence = z.infer<typeof verifierSchema>
export const deviationSchema = z
  .object({
    schema_version: z.literal(1),
    id,
    description: nonempty,
    ac_ids: z
      .array(z.string().refine((id) => acceptanceIds.includes(id)))
      .min(1)
      .refine(unique),
    contract_diff_sha256: digest,
    head_sha: sha,
    tested_sha: sha,
    approval: z
      .object({
        decision: z.enum(['approved', 'rejected', 'pending']),
        actor: id,
        source_uri: sourceUri,
        approved_at: z.iso.datetime().nullable(),
      })
      .strict(),
  })
  .strict()
export type DeviationEvidence = z.infer<typeof deviationSchema>
export const gateSchema = z
  .object({
    schema_version: z.literal(1),
    name: z.literal('Deterministic gate'),
    head_sha: sha,
    tested_sha: sha,
    run_id: id,
    run_attempt: z.number().int().positive(),
    provider_id: id,
    conclusion: z.enum(['success', 'failure', 'cancelled', 'timed_out', 'skipped', 'in_progress', 'unavailable']),
    source_uri: sourceUri.nullable(),
  })
  .strict()
export const bundleSchema = z
  .object({
    schema_version: z.literal(1),
    context: contextSchema,
    lanes: z.array(laneSchema).refine((lanes) => unique(lanes.map((lane) => lane.lane_id)), 'Duplicate lane IDs'),
    reviews: z
      .array(reviewSchema)
      .refine((reviews) => unique(reviews.map((review) => review.role)), 'Duplicate review roles'),
    verifier: verifierSchema.nullable(),
    deviations: z
      .array(deviationSchema)
      .refine((deviations) => unique(deviations.map((deviation) => deviation.id)), 'Duplicate deviation IDs'),
    gate: gateSchema,
  })
  .strict()
export type ReadinessBundle = z.infer<typeof bundleSchema>
