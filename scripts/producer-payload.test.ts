import {expect, it} from 'bun:test'

import {readinessFixture} from './fixtures/readiness'
import {producerPayload} from './producer-payload'

it.each(['valid', 'empty-report', 'extra-field', 'malformed-review'])(
  'AC-32 producer payload shape only: %s',
  (kind) => {
    const payload: Record<string, unknown> = {
      raw_report_markdown: 'Supporting report, not authenticated by schema parsing.',
      reviews: readinessFixture().reviews,
      verifier: null,
    }
    if (kind === 'empty-report') payload.raw_report_markdown = ''
    if (kind === 'extra-field') payload.approved = true
    if (kind === 'malformed-review') payload.reviews = [{}]
    expect(producerPayload.safeParse(payload).success).toBe(kind === 'valid')
  },
)
