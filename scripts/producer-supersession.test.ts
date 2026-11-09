import {expect, it} from 'bun:test'

import {producerFixture as fixture} from './fixtures/producer'
import {ProducerBlockers, providerProducerState} from './producer-evidence'
import {readiness} from './readiness'

it.each(['older-pass', 'newer-pass-omits-blocker'] as const)(
  'AC-32 cannot cherry-pick %s over an unresolved authenticated review',
  async (kind) => {
    const f = fixture(),
      selected = kind === 'older-pass' ? f.selected : f.resolved
    await expect(providerProducerState(selected.uri, f.bundle.context, f.read())).rejects.toBeInstanceOf(
      ProducerBlockers,
    )
  },
)
it('AC-32 later independent resolution must name this exact review before an old blocker disappears', async () => {
  const f = fixture()
  f.resolved.payload.reviews[0].findings.push({...f.blocker, status: 'resolved', resolution_source_uri: f.resolved.uri})
  expect((await providerProducerState(f.resolved.uri, f.bundle.context, f.read())).payload).toEqual(f.resolved.payload)
  f.resolved.payload.reviews[0].findings[0].resolution_source_uri = f.selected.uri
  await expect(providerProducerState(f.resolved.uri, f.bundle.context, f.read())).rejects.toBeInstanceOf(
    ProducerBlockers,
  )
})
it('AC-32 older passing verdict is stale even when a later same-role verdict also passes', async () => {
  const f = fixture()
  const read = f.read([f.selected, f.resolved])
  await expect(providerProducerState(f.selected.uri, f.bundle.context, read)).rejects.toThrow('superseded')
  expect((await providerProducerState(f.resolved.uri, f.bundle.context, read)).payload).toEqual(f.resolved.payload)
})
it('AC-32 role-specific selection preserves an older security record when only code is superseded', async () => {
  const f = fixture()
  f.resolved.payload.reviews = f.resolved.payload.reviews.filter((record) => record.role === 'code')
  expect(
    (await providerProducerState(f.selected.uri, f.bundle.context, f.read([f.selected, f.resolved]), 'security'))
      .payload,
  ).toEqual(f.selected.payload)
  await expect(
    providerProducerState(f.selected.uri, f.bundle.context, f.read([f.selected, f.resolved]), 'code'),
  ).rejects.toThrow('superseded')
})
it.each(['head', 'merge', 'human'] as const)(
  'AC-32 unrelated %s reviews cannot supersede this exact producer',
  async (kind) => {
    const f = fixture()
    if (kind === 'head') f.later.review.commit_id = 'f'.repeat(40)
    if (kind === 'merge') for (const record of f.later.payload.reviews) record.tested_sha = 'f'.repeat(40)
    if (kind === 'human') f.later.review.user = {login: 'NazarUsik', type: 'User'}
    expect(
      (await providerProducerState(f.selected.uri, f.bundle.context, f.read([f.selected, f.later]))).payload,
    ).toEqual(f.selected.payload)
  },
)
it.each(['prose', 'hash', 'dismissed', 'timestamp', 'pending'] as const)(
  'AC-32 newer %s provider output cannot leave an obsolete pass current',
  async (kind) => {
    const f = fixture(),
      read = f.read([f.selected, f.later])
    if (kind === 'prose') f.later.review.body = 'New reviewer findings without a structured verdict'
    if (kind === 'hash')
      f.later.review.body = f.later.review.body.replace(
        f.later.payload.reviews[0].provenance.report_sha256,
        '0'.repeat(64),
      )
    if (kind === 'dismissed') f.later.review.state = 'DISMISSED'
    if (kind === 'timestamp') f.later.review.submitted_at = 'not-a-date'
    if (kind === 'pending') f.later.review.state = 'PENDING'
    await expect(providerProducerState(f.selected.uri, f.bundle.context, read)).rejects.toThrow()
  },
)
it('AC-32 pagination authenticates a later blocker on the second page', async () => {
  const f = fixture()
  const older = Array.from({length: 100}, (_, i) => ({id: 1000 + i, user: {login: 'human', type: 'User'}}))
  await expect(
    providerProducerState(f.selected.uri, f.bundle.context, f.read([f.selected, f.later], older)),
  ).rejects.toBeInstanceOf(ProducerBlockers)
})
it('AC-32 resolving a code finding cannot clear a security finding with the same ID', async () => {
  const f = fixture()
  f.later.payload.reviews[1].findings.push({...f.blocker})
  f.resolved.payload.reviews[0].findings.push({...f.blocker, status: 'resolved', resolution_source_uri: f.resolved.uri})
  try {
    await providerProducerState(f.resolved.uri, f.bundle.context, f.read())
    throw Error('Expected independent security blocker')
  } catch (error) {
    expect(error).toBeInstanceOf(ProducerBlockers)
    expect((error as ProducerBlockers).reviews).toContainEqual(
      expect.objectContaining({record: f.later.payload.reviews[1]}),
    )
  }
})
it('AC-32 newer verifier reports supersede only verifier selection and retain known failing ACs', async () => {
  const f = fixture(),
    prior = f.make(780, 30, true),
    later = f.make(781, 40, true)
  later.payload.verifier!.rows[31].result = 'fail'
  later.payload.verifier!.rows[31].exit_code = 1
  const read = f.read([f.selected, prior, later])
  await expect(providerProducerState(prior.uri, f.bundle.context, read, 'verifier')).rejects.toThrow('superseded')
  f.bundle.verifier = later.payload.verifier
  f.bundle.reviews = f.selected.payload.reviews
  const report = await readiness(f.bundle, Bun.version, {
    context: async () => {},
    artifact: async () => {},
    gate: async () => {},
    deviation: async () => {},
    producer: async (record, context) => {
      await providerProducerState(record.provenance.source_uri, context, read, record.provenance.producer_role)
    },
  })
  expect(report.exit_code).toBe(1)
  expect(report.reasons.some((reason) => reason.subject === 'AC-32' && reason.kind === 'failure')).toBe(true)
})
it('AC-32 nonterminating review pagination is bounded without treating a partial history as current', async () => {
  const f = fixture(),
    original = f.read([f.selected])
  let pages = 0
  await expect(
    providerProducerState(f.selected.uri, f.bundle.context, async (ctx, endpoint) => {
      if (!endpoint.includes('?')) return original(ctx, endpoint)
      pages++
      return Array.from({length: 100}, (_, i) => ({id: 10000 + pages * 100 + i, user: {login: 'human', type: 'User'}}))
    }),
  ).rejects.toThrow('pagination limit')
  expect(pages).toBe(100)
})
it('AC-32 review history has an aggregate byte cap as well as per-review and page bounds', async () => {
  const f = fixture()
  const history = Array.from({length: 12}, (_, i) => ({
    ...f.selected.review,
    id: 1000 + i,
    body: ' '.repeat(200000),
    submitted_at: '2026-11-04T12:00:30.000Z',
  }))
  await expect(providerProducerState(f.selected.uri, f.bundle.context, f.read([f.selected], history))).rejects.toThrow(
    'oversized',
  )
})
it.each(['duplicate', 'missing', 'changed', 'malformed', 'unavailable'] as const)(
  'AC-32 incomplete current review listing fails closed: %s',
  async (kind) => {
    const f = fixture(),
      original = f.read([f.selected])
    await expect(
      providerProducerState(f.selected.uri, f.bundle.context, async (ctx, endpoint) => {
        if (!endpoint.includes('?')) return original(ctx, endpoint)
        if (kind === 'unavailable') throw Error('Provider unavailable')
        if (kind === 'missing') return []
        if (kind === 'malformed') return {}
        if (kind === 'duplicate') return [f.selected.review, f.selected.review]
        return [{...f.selected.review, body: 'Changed after selected review was read'}]
      }),
    ).rejects.toThrow()
  },
)
it('AC-32 complete readiness preserves later provider blockers and unrelated missing-lane diagnostics', async () => {
  for (const missing of [false, true]) {
    const f = fixture()
    f.bundle.reviews = f.selected.payload.reviews
    if (missing) f.bundle.lanes = f.bundle.lanes.filter((lane) => lane.lane_id !== 'quality')
    const read = f.read([f.selected, f.later])
    const report = await readiness(f.bundle, Bun.version, {
      context: async () => {},
      artifact: async () => {},
      gate: async () => {},
      deviation: async () => {},
      producer: async (record, context) => {
        if ('role' in record) await providerProducerState(record.provenance.source_uri, context, read, record.role)
      },
    })
    expect(report.verdict).toBe('not-ready')
    expect(report.exit_code).toBe(1)
    expect(report.reasons).toContainEqual({
      kind: 'failure',
      subject: 'code/later-blocker',
      message: 'Open blocking finding',
    })
    expect(report.evidence).toContain(f.later.uri)
    if (missing)
      expect(report.reasons.some((reason) => reason.subject === 'quality' && reason.kind === 'blocked')).toBe(true)
  }
})
it.each(['selected', 'partial-page'] as const)(
  'AC-32 authenticated %s blockers survive an unavailable history lookup',
  async (kind) => {
    const f = fixture()
    if (kind === 'selected') f.selected.payload.reviews[0].findings.push({...f.blocker})
    f.bundle.reviews = f.selected.payload.reviews
    const original = f.read([f.selected, f.later])
    const read = async (context: unknown, endpoint: string): Promise<unknown> => {
      if (!endpoint.includes('?')) return original(context, endpoint)
      if (kind === 'selected' || endpoint.includes('&page=')) throw Error('Provider page unavailable')
      return [
        f.selected.review,
        f.later.review,
        ...Array.from({length: 98}, (_, i) => ({
          id: 10000 + i,
          user: {login: 'human', type: 'User'},
        })),
      ]
    }
    const report = await readiness(f.bundle, Bun.version, {
      context: async () => {},
      artifact: async () => {},
      gate: async () => {},
      deviation: async () => {},
      producer: async (record, context) => {
        if ('role' in record) await providerProducerState(record.provenance.source_uri, context, read, record.role)
      },
    })
    expect(report.exit_code).toBe(1)
    expect(report.reasons.some((reason) => reason.kind === 'failure' && reason.subject === 'code/later-blocker')).toBe(
      true,
    )
    expect(report.reasons.some((reason) => reason.kind === 'blocked' && reason.subject === 'code')).toBe(true)
  },
)
