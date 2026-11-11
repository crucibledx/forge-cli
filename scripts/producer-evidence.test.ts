import {createHash} from 'node:crypto'

import {expect, it} from 'bun:test'

import {readinessFixture} from './fixtures/readiness'
import {currentPullRequest, providerGate} from './github-evidence'
import {providerProducerState} from './producer-evidence'
import {readiness} from './readiness'

function fixture() {
  const bundle = readinessFixture()
  const uri = 'https://github.com/crucibledx/forge-cli/pull/99#pullrequestreview-777'
  const markdown = 'Independent exact-revision report'
  const payload = {raw_report_markdown: markdown, reviews: bundle.reviews, verifier: null}
  for (const record of payload.reviews)
    Object.assign(record.provenance, {
      actor: 'factory-droid[bot]',
      producer_id: '777',
      source_uri: uri,
      report_sha256: createHash('sha256').update(markdown).digest('hex'),
      completed_at: '2026-11-04T12:00:00.000Z',
    })
  const review = {
    id: 777,
    user: {login: 'factory-droid[bot]', type: 'Bot'},
    commit_id: bundle.context.head_sha,
    submitted_at: '2026-11-04T12:00:00Z',
    state: 'COMMENTED',
    html_url: uri,
    body: '',
  }
  return {bundle, context: bundle.context, uri, payload, review}
}
it.each(['exact', 'head', 'base', 'merge', 'unmergeable'])('AC-32 binds readiness to the live PR: %s', async (kind) => {
  const context = readinessFixture().context
  const pr = {
    head: {sha: context.head_sha},
    base: {sha: context.base_sha},
    merge_commit_sha: context.tested_sha as string | null,
  }
  if (kind === 'head') pr.head.sha = 'f'.repeat(40)
  if (kind === 'base') pr.base.sha = 'f'.repeat(40)
  if (kind === 'merge') pr.merge_commit_sha = 'f'.repeat(40)
  if (kind === 'unmergeable') pr.merge_commit_sha = null
  const result = () => currentPullRequest(context, async () => pr)
  if (kind === 'exact') await expect(result()).resolves.toBeUndefined()
  else await expect(result()).rejects.toThrow()
})
it.each(['APPROVED', 'COMMENTED', 'CHANGES_REQUESTED'])(
  'AC-32 accepts completed independent structured reviews: %s',
  async (state) => {
    const {context, uri, payload, review} = fixture()
    review.state = state
    review.body = '```forge-evidence-v1\n' + JSON.stringify(payload) + '\n```'
    const actual = await providerProducerState(uri, context, async (_context, endpoint) => {
      expect(['/pulls/99/reviews/777', '/pulls/99/reviews?per_page=100']).toContain(endpoint)
      return endpoint.includes('?') ? [review] : review
    })
    expect(actual.payload).toEqual(payload)
  },
)
it('AC-32 completed authenticated change requests retain known failure precedence', async () => {
  const {bundle, context, uri, payload, review} = fixture()
  payload.reviews[0].findings.push({
    id: 'known',
    severity: 'blocking',
    status: 'open',
    evidence: ['fixtures/check.log'],
  })
  review.state = 'CHANGES_REQUESTED'
  review.body = '```forge-evidence-v1\n' + JSON.stringify(payload) + '\n```'
  bundle.reviews = payload.reviews
  const report = await readiness(bundle, Bun.version, {
    context: async () => {},
    artifact: async () => {},
    gate: async () => {},
    deviation: async () => {},
    producer: async (record) => {
      if (!('role' in record)) return
      const authenticated = await providerProducerState(uri, context, async (_context, endpoint) =>
        endpoint.includes('?') ? [review] : review,
      )
      expect(authenticated.payload.reviews).toContainEqual(record)
    },
  })
  expect(report.exit_code).toBe(1)
  expect(report.reasons).toContainEqual({kind: 'failure', subject: 'code/known', message: 'Open blocking finding'})
})
it.each([
  'local-session',
  'comment',
  'implementer',
  'not-bot',
  'wrong-head',
  'wrong-merge',
  'hash',
  'actor',
  'producer-id',
  'role',
  'timestamp',
  'dismissed',
  'pending',
  'prose-only',
])('AC-32 refuses independent-producer forgery: %s', async (kind) => {
  const f = fixture()
  let uri = f.uri
  if (kind === 'local-session') uri = readinessFixture().reviews[0].provenance.source_uri
  if (kind === 'comment') uri = 'https://github.com/crucibledx/forge-cli/issues/99#issuecomment-777'
  if (kind === 'implementer') f.review.user.login = 'NazarUsik'
  if (kind === 'not-bot') f.review.user.type = 'User'
  if (kind === 'wrong-head') f.review.commit_id = 'f'.repeat(40)
  if (kind === 'wrong-merge') f.payload.reviews[0].tested_sha = 'f'.repeat(40)
  if (kind === 'hash') f.payload.raw_report_markdown += ' forged'
  if (kind === 'actor') f.payload.reviews[0].provenance.actor = 'implementer'
  if (kind === 'producer-id') f.payload.reviews[0].provenance.producer_id = 'another'
  if (kind === 'role') f.payload.reviews[0].provenance.producer_role = 'verifier'
  if (kind === 'timestamp') f.payload.reviews[0].provenance.completed_at = '2026-11-05T12:00:00.000Z'
  if (kind === 'dismissed') f.review.state = 'DISMISSED'
  if (kind === 'pending') f.review.state = 'PENDING'
  f.review.body = kind === 'prose-only' ? 'All good' : '```forge-evidence-v1\n' + JSON.stringify(f.payload) + '\n```'
  let calls = 0
  await expect(
    providerProducerState(uri, f.context, async () => {
      calls++
      return f.review
    }),
  ).rejects.toThrow()
  if (kind === 'local-session' || kind === 'comment') expect(calls).toBe(0)
})
it.each(['success', 'failure', 'missing', 'in_progress', 'stale-success', 'stale-no-end'])(
  'AC-32 collector obtains the actual selected provider gate: %s',
  async (kind) => {
    const context = readinessFixture().context
    const result = () =>
      providerGate(context, async (_context, endpoint) => {
        expect(endpoint).toBe('/actions/runs/123/attempts/1/jobs?per_page=100')
        return {
          total_count: kind === 'missing' ? 0 : 1,
          jobs:
            kind === 'missing'
              ? []
              : [
                  {
                    id: 456,
                    name: 'Deterministic gate',
                    status: ['in_progress', 'stale-success', 'stale-no-end'].includes(kind)
                      ? 'in_progress'
                      : 'completed',
                    conclusion: kind.startsWith('stale-') ? 'success' : kind,
                    completed_at: kind === 'stale-success' ? '2026-11-04T10:01:00Z' : null,
                  },
                ],
        }
      })
    if (['missing', 'in_progress', 'stale-no-end'].includes(kind)) await expect(result()).rejects.toThrow()
    else expect((await result()).conclusion).toBe(kind === 'failure' ? 'failure' : 'success')
  },
)
