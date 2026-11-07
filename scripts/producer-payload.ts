import {z} from 'zod'

import {reviewSchema, verifierSchema} from './evidence-schema'

/** Shape only. The hosted provider separately authenticates identity, revision and hash. */
export const producerPayload = z
  .object({
    raw_report_markdown: z
      .string()
      .min(1)
      .max(256 * 1024),
    reviews: z
      .array(reviewSchema)
      .max(2)
      .refine(
        (reviews) => new Set(reviews.map((review) => review.role)).size === reviews.length,
        'Duplicate review roles',
      ),
    verifier: verifierSchema.nullable(),
  })
  .strict()
