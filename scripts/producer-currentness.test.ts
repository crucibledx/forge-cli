import {writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {expect, it} from 'bun:test'

import {collectProducers} from './collect-readiness'
import {provenanceSchema, reviewSchema} from './evidence-schema'
import {producerFixture} from './fixtures/producer'
import type {githubJSON} from './github-evidence'
import {MAX_SELECTED_PRODUCERS} from './producer-evidence'
import {producerPayload} from './producer-payload'
import {PRODUCER_ROLES, REVIEW_ROLES} from './producer-roles'
import {readiness} from './readiness'
import {readinessProvider} from './readiness-provider'

const dir = useTmpDir('producer-currentness')
it.each([false, true])(
  'AC-32 role participation is bound to each authenticated version, originally combined=%s',
  async (combined) => {
    const f = producerFixture(),
      old = f.make(780, 30, true)
    if (combined) old.payload.reviews = f.make(780, 30).payload.reviews.filter((r) => r.role === 'code')
    Object.assign(old.payload.verifier!.rows[1], {result: 'fail', exit_code: 1, evidence: [old.uri]})
    const edited = structuredClone(old)
    edited.payload.reviews = f.make(780, 30).payload.reviews.filter((r) => r.role === 'code')
    Object.assign(edited.payload.verifier!.rows[1], {result: 'pass', exit_code: 0})
    f.read([f.selected, old])
    edited.review.body = '```forge-evidence-v1\n' + JSON.stringify(edited.payload) + '\n```'
    f.bundle.reviews = f.selected.payload.reviews
    f.bundle.verifier = edited.payload.verifier
    let lookup = 0
    const report = await evaluate(f, [], {
      read: async (_context, endpoint) => {
        if (endpoint.endsWith('/777')) lookup++
        const sources = [f.selected, lookup > 1 ? edited : old]
        if (endpoint.includes('?')) return sources.map((source) => source.review)
        const source = sources.find((item) => endpoint.endsWith('/' + item.review.id))
        if (!source) throw Error('Unknown synthetic review')
        return source.review
      },
    })
    expect(report.exit_code).toBe(combined ? 2 : 1)
    expect(report.reasons.some((reason) => reason.kind === 'failure' && reason.subject === 'AC-2')).toBe(!combined)
  },
)

it('AC-32 removing a role between lookups cannot combine two different versions into approval', async () => {
  const f = producerFixture(),
    verifier = f.make(780, 30, true)
  const edited = structuredClone(f.selected)
  edited.payload.reviews = edited.payload.reviews.filter((record) => record.role === 'security')
  f.read([f.selected, verifier])
  edited.review.body = '```forge-evidence-v1\n' + JSON.stringify(edited.payload) + '\n```'
  f.bundle.reviews = [f.selected.payload.reviews[0], edited.payload.reviews[0]]
  f.bundle.verifier = verifier.payload.verifier
  let lookup = 0
  const report = await evaluate(f, [], {
    read: async (_context, endpoint) => {
      if (endpoint.endsWith('/777')) lookup++
      const sources = [lookup > 1 ? edited : f.selected, verifier]
      if (endpoint.includes('?')) return sources.map((source) => source.review)
      const source = sources.find((item) => endpoint.endsWith('/' + item.review.id))
      if (!source) throw Error('Unknown synthetic review')
      return source.review
    },
  })
  expect(report.exit_code).toBe(2)
  expect(report.reasons.some((reason) => reason.message.includes('Conflicting authenticated producer versions'))).toBe(
    true,
  )
  expect(report.reasons.some((reason) => reason.kind === 'failure')).toBe(false)
})

it.each(
  ['code', 'security', 'verifier'].flatMap((role) =>
    ['edited-resolution', 'invalid-evidence', 'stable-pass'].map((change) => ({role, change})),
  ),
)('AC-32 all role lookups share same-ID version authority: $role/$change', async ({role, change}) => {
  const f = producerFixture(),
    verifier = f.make(780, 30, true)
  for (const row of verifier.payload.verifier!.rows) row.evidence = [verifier.uri]
  const selected = role === 'verifier' ? verifier : f.selected
  const evidence = change === 'invalid-evidence' ? 'checks/nonexistent/old.log' : selected.uri
  if (change !== 'stable-pass') {
    if (role === 'verifier')
      Object.assign(selected.payload.verifier!.rows[1], {result: 'fail', exit_code: 1, evidence: [evidence]})
    else selected.payload.reviews.find((r) => r.role === role)!.findings = [{...f.blocker, evidence: [evidence]}]
  }
  const edited = structuredClone(selected)
  if (role === 'verifier')
    Object.assign(edited.payload.verifier!.rows[1], {result: 'pass', exit_code: 0, evidence: [edited.uri]})
  else if (change !== 'stable-pass')
    edited.payload.reviews.find((r) => r.role === role)!.findings = [
      {
        ...f.blocker,
        status: 'resolved',
        resolution_source_uri: edited.uri,
        evidence: [edited.uri],
      },
    ]
  const sources = [f.selected, verifier]
  f.read(sources)
  edited.review.body = '```forge-evidence-v1\n' + JSON.stringify(edited.payload) + '\n```'
  f.bundle.reviews = role === 'verifier' ? f.selected.payload.reviews : edited.payload.reviews
  f.bundle.verifier = role === 'verifier' ? edited.payload.verifier : verifier.payload.verifier
  let lookup = 0
  const read: typeof githubJSON = async (_context, endpoint) => {
    if (endpoint.endsWith('/777')) lookup++
    const current = sources.map((source) => (source.review.id === edited.review.id && lookup > 1 ? edited : source))
    if (endpoint.includes('?')) return current.map((source) => source.review)
    const match = current.find((source) => endpoint.endsWith('/' + source.review.id))
    if (!match) throw Error('Unknown synthetic review')
    return match.review
  }
  const report = await evaluate(f, [], {read, rejectedEvidence: 'checks/nonexistent/old.log'})
  expect(report.exit_code).toBe(change === 'stable-pass' ? 0 : change === 'invalid-evidence' ? 2 : 1)
  const subject = role === 'verifier' ? 'AC-2' : `${role}/${f.blocker.id}`
  expect(report.reasons.some((r) => r.kind === 'failure' && r.subject === subject)).toBe(change === 'edited-resolution')
  if (change === 'edited-resolution' && role === 'verifier')
    expect(report.ac_results.find((row) => row.ac_id === 'AC-2')!.result).toBe('fail')
})

it.each(
  ['code', 'security', 'verifier'].flatMap((role) =>
    ['new-failure', 'edited-resolution', 'invalid-failure'].map((change) => ({role, change})),
  ),
)(
  'AC-32 changed authenticated $role versions retain only proved adverse authority: $change',
  async ({role, change}) => {
    const f = producerFixture(),
      verifier = f.make(780, 30, true)
    for (const row of verifier.payload.verifier!.rows) row.evidence = [verifier.uri]
    const selected = role === 'verifier' ? verifier : f.selected
    if (change === 'edited-resolution') {
      if (role === 'verifier') Object.assign(verifier.payload.verifier!.rows[1], {result: 'fail', exit_code: 1})
      else
        f.selected.payload.reviews.find((r) => r.role === role)!.findings = [{...f.blocker, evidence: [selected.uri]}]
    }
    const edited = structuredClone(selected)
    const evidence = change === 'invalid-failure' ? 'checks/nonexistent/changed.log' : selected.uri
    if (role === 'verifier') {
      Object.assign(edited.payload.verifier!.rows[1], {
        result: change === 'edited-resolution' ? 'pass' : 'fail',
        exit_code: change === 'edited-resolution' ? 0 : 1,
        evidence: [evidence],
      })
    } else
      edited.payload.reviews.find((r) => r.role === role)!.findings = [
        {
          ...f.blocker,
          status: change === 'edited-resolution' ? 'resolved' : 'open',
          ...(change === 'edited-resolution' ? {resolution_source_uri: selected.uri} : {}),
          evidence: [evidence],
        },
      ]
    const sources = [f.selected, verifier],
      original = f.read(sources)
    edited.review.body = '```forge-evidence-v1\n' + JSON.stringify(edited.payload) + '\n```'
    f.bundle.reviews = f.selected.payload.reviews
    f.bundle.verifier = verifier.payload.verifier
    const report = await evaluate(f, [], {
      read: async (context, endpoint) =>
        endpoint.includes('?')
          ? sources.map((source) => (source.review.id === edited.review.id ? edited.review : source.review))
          : original(context, endpoint),
      rejectedEvidence: 'checks/nonexistent/changed.log',
    })
    const proven = change !== 'invalid-failure'
    expect(report.exit_code).toBe(proven ? 1 : 2)
    expect(report.reasons.some((r) => r.kind === 'failure')).toBe(proven)
    if (proven)
      expect(
        report.reasons.some(
          (r) => r.kind === 'failure' && r.subject === (role === 'verifier' ? 'AC-2' : `${role}/${f.blocker.id}`),
        ),
      ).toBe(true)
    expect(report.reasons.some((r) => r.kind === 'blocked' && r.message.includes('changed'))).toBe(true)
  },
)
it.each([false, true])(
  'AC-32 unavailable initial producer GET cannot abort a valid failed sibling, reverse=%s',
  async (reverse) => {
    const f = producerFixture(),
      failed = f.make(780, 30, true)
    for (const row of failed.payload.verifier!.rows) row.evidence = [failed.uri]
    Object.assign(failed.payload.verifier!.rows[1], {result: 'fail', exit_code: 1})
    const sources = reverse ? [failed, f.selected] : [f.selected, failed],
      original = f.read(sources)
    const read: typeof githubJSON = async (context, endpoint) => {
      if (endpoint.endsWith('/777')) throw Error('Synthetic selected GET503')
      return original(context, endpoint)
    }
    const unavailable: unknown[] = []
    const imported = await collectProducers(
      sources.map((s) => s.uri),
      f.bundle.context,
      read,
      (error) => unavailable.push(error),
    )
    expect(unavailable).toHaveLength(1)
    const records = imported.flatMap((s) => s.records)
    f.bundle.reviews = records.filter((r) => 'role' in r)
    f.bundle.verifier = records.find((r) => 'rows' in r) as typeof f.bundle.verifier
    const report = await evaluate(f, [], {read, candidates: sources.map((s) => s.uri)})
    expect(report.exit_code).toBe(1)
    expect(report.ac_results.find((r) => r.ac_id === 'AC-2')!.result).toBe('fail')
  },
)
it.each([false, true])(
  'AC-32 four routing candidates preserve separate roles and overlapping verifiers, reverse=%s',
  async (reverse) => {
    const f = producerFixture(),
      failed = f.make(780, 30, true),
      unavailable = f.make(781, 40, true)
    f.resolved.payload.reviews = f.resolved.payload.reviews.filter((r) => r.role === 'code')
    for (const source of [failed, unavailable])
      for (const row of source.payload.verifier!.rows) row.evidence = [source.uri]
    Object.assign(failed.payload.verifier!.rows[1], {result: 'fail', exit_code: 1})
    unavailable.payload.verifier!.completion = 'unavailable'
    const sources = [f.selected, f.resolved, failed, unavailable],
      original = f.read(sources)
    const read: typeof githubJSON = async (context, endpoint) => {
      if (endpoint.includes('?')) throw Error('Synthetic history503')
      return original(context, endpoint)
    }
    const selected = reverse ? [...sources].reverse() : sources
    const imported = await collectProducers(
      selected.map((s) => s.uri),
      f.bundle.context,
      read,
    )
    const records = imported.flatMap((s) => s.records)
    f.bundle.reviews = records.filter((r) => 'role' in r)
    f.bundle.verifier = records.find((r) => 'rows' in r) as typeof f.bundle.verifier
    const report = await evaluate(f, [], {read, candidates: selected.map((s) => s.uri)})
    expect(report.exit_code).toBe(1)
    expect(report.ac_results.find((r) => r.ac_id === 'AC-2')!.result).toBe('fail')
  },
)
type Fixture = ReturnType<typeof producerFixture>
type Source = ReturnType<Fixture['make']>
/** Real producer adapter; the selected-run artifact/context ports below are explicitly synthetic. */
async function evaluate(
  f: Fixture,
  sources: Source[],
  options: {read?: typeof githubJSON; rejectedEvidence?: string; candidates?: string[]; consulted?: string[]} = {},
) {
  if (options.candidates) await writeFile(join(dir(), 'producers.json'), JSON.stringify(options.candidates))
  const provider = readinessProvider(dir(), {
    githubJSON: options.read ?? f.read(sources),
    archive: async () => {
      throw Error('Unexpected archive')
    },
  })
  return readiness(f.bundle, Bun.version, {
    context: async () => {},
    gate: async () => {},
    deviation: async () => {},
    artifact: async (ref, context) => {
      options.consulted?.push(ref)
      if (ref === options.rejectedEvidence) throw Error('Unavailable independent row evidence')
      if (ref.startsWith('https:')) await provider.artifact(ref, context)
    },
    producer: async (record, context) => {
      if (record.provenance.source_uri.startsWith('https:')) return provider.producer(record, context)
    },
  })
}

it('AC-32 producer schemas share one const role authority', () => {
  expect(Object.values(PRODUCER_ROLES)).toEqual(['code', 'security', 'verifier'])
  expect(REVIEW_ROLES).toEqual(['code', 'security'])
  expect(provenanceSchema.shape.producer_role.options).toEqual(Object.values(PRODUCER_ROLES))
  expect(reviewSchema.shape.role.options).toEqual([...REVIEW_ROLES])
  expect(provenanceSchema.shape.producer_role.safeParse('owner').success).toBe(false)
})
it.each(REVIEW_ROLES)('AC-32 rejects hidden duplicate %s records before accepting its passing entry', async (role) => {
  const f = producerFixture()
  const passing = f.selected.payload.reviews.find((record) => record.role === role)!
  const hidden = structuredClone(passing)
  hidden.findings.push(f.blocker)
  f.selected.payload.reviews = [passing, hidden]
  f.resolved.payload.reviews = f.resolved.payload.reviews.filter((record) => record.role !== role)
  f.bundle.reviews = [passing, ...f.resolved.payload.reviews]
  expect(producerPayload.safeParse(f.selected.payload).success).toBe(false)
  const report = await evaluate(f, [f.selected, f.resolved])
  expect(report.exit_code).toBe(2)
  expect(report.reasons.some((reason) => reason.kind === 'failure')).toBe(false)
})
it.each(['a-b', 'b-a'] as const)(
  'AC-32 collection selects current security A and code B in either order: %s',
  async (order) => {
    const f = producerFixture()
    f.resolved.payload.reviews = f.resolved.payload.reviews.filter((record) => record.role === 'code')
    const selected = order === 'a-b' ? [f.selected, f.resolved] : [f.resolved, f.selected]
    const imported = await collectProducers(
      selected.map((source) => source.uri),
      f.bundle.context,
      f.read(selected),
    )
    const records = imported.flatMap((source) => source.records)
    expect(records).toHaveLength(2)
    expect(records.find((record) => 'role' in record && record.role === 'security')).toEqual(
      f.selected.payload.reviews[1],
    )
    expect(records.find((record) => 'role' in record && record.role === 'code')).toEqual(f.resolved.payload.reviews[0])
  },
)
it('AC-32 collection preserves combined current roles and rejects duplicate/excessive selections', async () => {
  const f = producerFixture(),
    read = f.read([f.selected])
  expect((await collectProducers([f.selected.uri], f.bundle.context, read))[0].records).toEqual(
    f.selected.payload.reviews,
  )
  await expect(collectProducers([f.selected.uri, f.selected.uri], f.bundle.context, read)).rejects.toThrow('Duplicate')
  await expect(
    collectProducers(
      Array.from({length: MAX_SELECTED_PRODUCERS + 1}, (_, i) => String(i)),
      f.bundle.context,
      read,
    ),
  ).rejects.toThrow('Too many')
})
it('AC-32 collection preserves unresolved authenticated records for aggregation, not invalid payloads', async () => {
  const f = producerFixture()
  const imported = await collectProducers([f.selected.uri, f.resolved.uri], f.bundle.context, f.read())
  expect(imported[0].records).toEqual(f.resolved.payload.reviews)
  f.bundle.reviews = f.resolved.payload.reviews
  expect((await evaluate(f, [f.selected, f.later, f.resolved])).exit_code).toBe(1)
  const read = f.read([f.selected])
  f.selected.review.body = 'Malformed selected attestation'
  expect(await collectProducers([f.selected.uri], f.bundle.context, read)).toEqual([])
})
it.each(['missing-user', 'missing-type', 'invalid-type', 'wrong-app-type'] as const)(
  'AC-32 incomplete actor history cannot leave a stale review ready: %s',
  async (kind) => {
    const f = producerFixture(),
      original = f.read([f.selected, f.later])
    f.bundle.reviews = f.selected.payload.reviews
    const report = await evaluate(f, [], {
      read: async (context, endpoint) => {
        if (!endpoint.includes('?')) return original(context, endpoint)
        const later: Record<string, unknown> = structuredClone(f.later.review)
        if (kind === 'missing-user') delete later.user
        else
          later.user =
            kind === 'missing-type'
              ? {login: 'factory-droid[bot]'}
              : {login: 'factory-droid[bot]', type: kind === 'invalid-type' ? 'invalid' : 'User'}
        return [f.selected.review, later]
      },
    })
    expect(report.exit_code).toBe(2)
    expect(report.reasons.some((reason) => reason.kind === 'failure')).toBe(false)
  },
)
it.each(['actor', 'revision', 'timestamp'] as const)(
  'AC-32 earlier malformed %s metadata cannot hide a later authenticated blocker',
  async (kind) => {
    const f = producerFixture(),
      raw: Record<string, unknown> = {id: 10000, user: {login: 'factory-droid[bot]', type: 'Bot'}}
    if (kind === 'actor') delete raw.user
    if (kind === 'timestamp') Object.assign(raw, {commit_id: f.bundle.context.head_sha, submitted_at: 'invalid'})
    f.bundle.reviews = f.selected.payload.reviews
    const report = await evaluate(f, [], {read: f.read([f.selected, f.later], [raw])})
    expect(report.exit_code).toBe(1)
    expect(report.reasons.some((reason) => reason.subject === 'code/later-blocker' && reason.kind === 'failure')).toBe(
      true,
    )
  },
)
it('AC-32 malformed older exact-revision app history is unavailable, not silently forgotten', async () => {
  const f = producerFixture(),
    read = f.read([f.selected, f.resolved])
  f.bundle.reviews = f.resolved.payload.reviews
  f.selected.review.body = 'No verifiable structured verdict'
  expect((await evaluate(f, [], {read})).exit_code).toBe(2)
})
it.each(['old-open', 'resolved', 'selected-pass', 'new-pass'] as const)(
  'AC-32 human dismissal is not an independent resolution or passing approval: %s',
  async (mode) => {
    const f = producerFixture()
    f.later.review.state = 'DISMISSED'
    if (mode === 'resolved')
      f.resolved.payload.reviews[0].findings.push({
        ...f.blocker,
        status: 'resolved',
        resolution_source_uri: f.resolved.uri,
      })
    let sources = [f.later, f.resolved]
    f.bundle.reviews = f.resolved.payload.reviews
    if (mode === 'selected-pass') {
      f.selected.review.state = 'DISMISSED'
      sources = [f.selected]
      f.bundle.reviews = f.selected.payload.reviews
    }
    if (mode === 'new-pass') {
      f.resolved.review.state = 'DISMISSED'
      sources = [f.selected, f.resolved]
      f.bundle.reviews = f.selected.payload.reviews
    }
    const report = await evaluate(f, sources)
    expect(report.exit_code).toBe(mode === 'old-open' ? 1 : mode === 'resolved' ? 0 : 2)
  },
)
it.each([
  'selected-outage',
  'partial-outage',
  'superseded',
  'current',
  'zero-outage',
  'null-outage',
  'missing-outage',
  'unavailable-outage',
  'forged-outage',
  'stale-outage',
  'same-producer-outage',
] as const)('AC-32 verifier failure authority requires independently valid rows: %s', async (mode) => {
  const f = producerFixture(),
    prior = f.make(780, 30, true),
    failed = f.make(781, 40, true)
  const row = failed.payload.verifier!.rows[0]
  row.result = 'fail'
  row.exit_code = 1
  if (mode === 'zero-outage') row.exit_code = 0
  if (mode === 'null-outage') row.exit_code = null
  if (mode === 'missing-outage') row.evidence = ['unavailable.log']
  if (mode === 'unavailable-outage') failed.payload.verifier!.completion = 'unavailable'
  if (mode === 'forged-outage') failed.review.user.login = 'forged'
  if (mode === 'stale-outage') failed.payload.verifier!.tested_sha = 'f'.repeat(40)
  if (mode === 'same-producer-outage') failed.payload.verifier!.provenance.producer_id = '777'
  f.bundle.verifier = (mode === 'superseded' || mode === 'partial-outage' ? prior : failed).payload.verifier
  f.bundle.reviews = f.selected.payload.reviews
  const original = f.read([f.selected, prior, failed])
  const report = await evaluate(f, [], {
    rejectedEvidence: 'unavailable.log',
    read: async (context, endpoint) => {
      if (!endpoint.includes('?')) return original(context, endpoint)
      if (mode === 'partial-outage' && !endpoint.includes('&page='))
        return [
          f.selected.review,
          prior.review,
          failed.review,
          ...Array.from({length: 97}, (_, i) => ({id: 10000 + i, user: {login: 'human', type: 'User'}})),
        ]
      if (mode.endsWith('outage')) throw Error('Provider history unavailable')
      return original(context, endpoint)
    },
  })
  const known = ['selected-outage', 'partial-outage', 'superseded', 'current'].includes(mode)
  expect(report.exit_code).toBe(known ? 1 : 2)
  expect(report.reasons.some((reason) => reason.subject === 'AC-1' && reason.kind === 'failure')).toBe(known)
  if (known) {
    expect(report.ac_results.find((row) => row.ac_id === 'AC-1')?.result).toBe('fail')
    expect(report.evidence).toContain(failed.uri)
  }
})
it.each(['valid', 'missing', 'exit', 'blocked', 'incomplete', 'dismissed'] as const)(
  'AC-32 only an evidenced current pass can clear a previous verifier failure: %s',
  async (mode) => {
    const f = producerFixture(),
      prior = f.make(780, 30, true),
      current = f.make(781, 40, true)
    Object.assign(prior.payload.verifier!.rows[0], {result: 'fail', exit_code: 1})
    if (mode === 'missing') current.payload.verifier!.rows[0].evidence = ['unavailable.log']
    if (mode === 'exit') current.payload.verifier!.rows[0].exit_code = 1
    if (mode === 'blocked') Object.assign(current.payload.verifier!.rows[0], {result: 'blocked', exit_code: null})
    if (mode === 'incomplete') current.payload.verifier!.completion = 'unavailable'
    if (mode === 'dismissed') current.review.state = 'DISMISSED'
    f.bundle.reviews = f.selected.payload.reviews
    f.bundle.verifier = current.payload.verifier
    const report = await evaluate(f, [f.selected, prior, current], {rejectedEvidence: 'unavailable.log'})
    expect(report.exit_code).toBe(mode === 'valid' ? 0 : 1)
    if (mode !== 'valid') expect(report.ac_results.find((row) => row.ac_id === 'AC-1')?.result).toBe('fail')
  },
)
it.each(['complete', 'unavailable', 'dismissed'] as const)(
  'AC-32 only a completed non-dismissed review resolution clears a historical blocker: %s',
  async (mode) => {
    const f = producerFixture()
    f.selected.payload.reviews[0].findings.push(f.blocker)
    f.later.payload.reviews[0].findings = [{...f.blocker, status: 'resolved', resolution_source_uri: f.later.uri}]
    if (mode === 'unavailable') f.later.payload.reviews[0].completion = 'unavailable'
    if (mode === 'dismissed') f.later.review.state = 'DISMISSED'
    f.bundle.reviews = f.resolved.payload.reviews
    expect((await evaluate(f, [f.selected, f.later, f.resolved])).exit_code).toBe(mode === 'complete' ? 0 : 1)
  },
)
it.each([false, true])(
  'AC-32 incomplete open findings never gain failure authority, history outage=%s',
  async (outage) => {
    const f = producerFixture()
    f.selected.payload.reviews[0].completion = 'unavailable'
    f.selected.payload.reviews[0].findings.push(f.blocker)
    f.bundle.reviews = outage ? f.selected.payload.reviews : f.resolved.payload.reviews
    const read = f.read([f.selected, f.resolved])
    const report = await evaluate(f, [], {
      read: async (c, e) => {
        if (outage && e.includes('?')) throw Error('Synthetic unavailable history')
        return read(c, e)
      },
    })
    expect(report.exit_code).toBe(outage ? 2 : 0)
    expect(report.reasons.some((reason) => reason.kind === 'failure')).toBe(false)
  },
)
it.each(['a-b', 'b-a'] as const)(
  'AC-32 collector retains latest failing code and current older security: %s',
  async (order) => {
    const f = producerFixture()
    f.resolved.payload.reviews = f.resolved.payload.reviews.filter((record) => record.role === 'code')
    f.resolved.payload.reviews[0].findings.push({...f.blocker, evidence: [f.resolved.uri]})
    const sources = [f.selected, f.resolved]
    const selected = order === 'a-b' ? sources : [...sources].reverse()
    const imported = await collectProducers(
      selected.map((s) => s.uri),
      f.bundle.context,
      f.read(sources),
    )
    f.bundle.reviews = imported.flatMap((source) => source.records).filter((record) => 'role' in record)
    expect(f.bundle.reviews).toHaveLength(2)
    expect(f.bundle.reviews.find((r) => r.role === 'code')!.provenance.source_uri).toBe(f.resolved.uri)
    expect(f.bundle.reviews.find((r) => r.role === 'security')!.provenance.source_uri).toBe(f.selected.uri)
    expect((await evaluate(f, sources)).exit_code).toBe(1)
  },
)
it.each(['reviews-first', 'verifier-first'] as const)(
  'AC-32 history outage cannot make passing review collection suppress a valid failed verifier: %s',
  async (order) => {
    const f = producerFixture(),
      failed = f.make(780, 30, true)
    Object.assign(failed.payload.verifier!.rows[0], {result: 'fail', exit_code: 1})
    const sources = [f.selected, failed],
      original = f.read(sources)
    const read: typeof githubJSON = async (c, e) => {
      if (e.includes('?')) throw Error('Synthetic HTTP503')
      return original(c, e)
    }
    const selected = order === 'reviews-first' ? sources : [...sources].reverse()
    const imported = await collectProducers(
      selected.map((s) => s.uri),
      f.bundle.context,
      read,
    )
    const records = imported.flatMap((source) => source.records)
    f.bundle.reviews = records.filter((record) => 'role' in record)
    f.bundle.verifier = records.find((record) => 'rows' in record) as typeof f.bundle.verifier
    expect(records).toHaveLength(3)
    expect((await evaluate(f, [], {read})).exit_code).toBe(1)
  },
)
it.each(['a-b', 'b-a'] as const)(
  'AC-32 uncertain duplicate roles validate every selected candidate, not the routing fallback: %s',
  async (order) => {
    const f = producerFixture()
    f.resolved.payload.reviews = f.resolved.payload.reviews.filter((r) => r.role === 'code')
    f.resolved.payload.reviews[0].findings.push({...f.blocker, evidence: [f.resolved.uri]})
    const sources = [f.selected, f.resolved],
      original = f.read(sources)
    const read: typeof githubJSON = async (c, e) => {
      if (e.includes('?')) throw Error('Synthetic HTTP503')
      return original(c, e)
    }
    const selected = order === 'a-b' ? sources : [...sources].reverse()
    const imported = await collectProducers(
      selected.map((s) => s.uri),
      f.bundle.context,
      read,
    )
    f.bundle.reviews = imported.flatMap((source) => source.records).filter((record) => 'role' in record)
    expect(f.bundle.reviews.find((r) => r.role === 'code')!.provenance.source_uri).toBe(f.selected.uri)
    const report = await evaluate(f, [], {read, candidates: selected.map((s) => s.uri)})
    expect(report.exit_code).toBe(1)
    expect(report.evidence).toContain(f.resolved.uri)
  },
)
it.each(['code', 'security'] as const)(
  'AC-32 collection retains a superseded-only %s routing record so newer blockers reach aggregation',
  async (role) => {
    const f = producerFixture()
    f.later.payload.reviews.find((r) => r.role === role)!.findings = [{...f.blocker, evidence: [f.later.uri]}]
    const sources = [f.selected, f.later],
      read = f.read(sources)
    const imported = await collectProducers([f.selected.uri], f.bundle.context, read)
    f.bundle.reviews = imported.flatMap((s) => s.records).filter((r) => 'role' in r)
    expect(f.bundle.reviews).toHaveLength(2)
    const report = await evaluate(f, sources)
    expect(report.exit_code).toBe(1)
    expect(report.reasons.some((r) => r.kind === 'failure' && r.subject === `${role}/${f.blocker.id}`)).toBe(true)
    expect(report.evidence).toContain(f.later.uri)
  },
)
it.each(['a-v', 'v-a'].flatMap((order) => ['incomplete', 'missing-evidence'].map((invalid) => ({order, invalid}))))(
  'AC-32 $order history outage preserves valid AC-2 failure behind $invalid AC-1 candidate',
  async ({order, invalid}) => {
    const f = producerFixture(),
      unavailable = f.make(780, 30, true),
      failed = f.make(781, 40, true)
    Object.assign(unavailable.payload.verifier!.rows[0], {result: 'fail', exit_code: 1})
    if (invalid === 'incomplete') unavailable.payload.verifier!.completion = 'unavailable'
    else unavailable.payload.verifier!.rows[0].evidence = ['checks/nonexistent/unavailable.log']
    Object.assign(failed.payload.verifier!.rows[1], {result: 'fail', exit_code: 1})
    const sources = [f.selected, unavailable, failed],
      original = f.read(sources)
    const read: typeof githubJSON = async (context, endpoint) => {
      if (endpoint.includes('?')) throw Error('Synthetic history503')
      return original(context, endpoint)
    }
    const selected = order === 'a-v' ? sources : [...sources].reverse()
    const imported = await collectProducers(
      selected.map((s) => s.uri),
      f.bundle.context,
      read,
    )
    const records = imported.flatMap((s) => s.records)
    f.bundle.reviews = records.filter((r) => 'role' in r)
    f.bundle.verifier = records.find((r) => 'rows' in r) as typeof f.bundle.verifier
    expect(f.bundle.verifier!.provenance.source_uri).toBe(unavailable.uri)
    const report = await evaluate(f, [], {
      read,
      candidates: selected.map((s) => s.uri),
      rejectedEvidence: 'checks/nonexistent/unavailable.log',
    })
    expect(report.exit_code).toBe(1)
    expect(report.ac_results.find((r) => r.ac_id === 'AC-2')!.result).toBe('fail')
    expect(report.reasons.some((r) => r.kind === 'failure' && r.subject === 'AC-1')).toBe(false)
    expect(report.evidence).toContain(failed.uri)
  },
)
it.each(
  ['code', 'security'].flatMap((role) =>
    [false, true].flatMap((outage) => [false, true].map((missing) => ({role, outage, missing}))),
  ),
)(
  'AC-32 historical $role resolution evidence is authenticated before clearing, outage=$outage missing=$missing',
  async ({role, outage, missing}) => {
    const f = producerFixture(),
      consulted: string[] = []
    f.selected.payload.reviews.find((r) => r.role === role)!.findings.push({...f.blocker, evidence: [f.selected.uri]})
    for (const review of f.later.payload.reviews) review.findings = []
    const evidence = missing ? 'checks/nonexistent/resolution.log' : f.later.uri
    f.later.payload.reviews
      .find((r) => r.role === role)!
      .findings.push({
        ...f.blocker,
        status: 'resolved',
        resolution_source_uri: f.later.uri,
        evidence: [evidence],
      })
    f.bundle.reviews = f.resolved.payload.reviews
    const sources = [f.selected, f.later, f.resolved],
      original = f.read(sources)
    const read: typeof githubJSON = async (context, endpoint) => {
      if (outage && endpoint.includes('?')) throw Error('Synthetic history503')
      return original(context, endpoint)
    }
    const report = await evaluate(f, [], {
      read,
      candidates: sources.map((s) => s.uri),
      consulted,
      rejectedEvidence: 'checks/nonexistent/resolution.log',
    })
    expect(consulted).toContain(evidence)
    expect(report.exit_code).toBe(missing ? 1 : outage ? 2 : 0)
    expect(report.reasons.some((r) => r.kind === 'failure' && r.subject === `${role}/${f.blocker.id}`)).toBe(missing)
    if (missing) {
      expect(report.evidence).toContain(f.selected.uri)
      expect(report.reasons.some((r) => r.kind === 'blocked' && r.subject === evidence)).toBe(true)
    }
  },
)
it('AC-32 unauthenticated historical finding evidence cannot create known failure authority', async () => {
  const f = producerFixture()
  f.selected.payload.reviews[0].findings.push({...f.blocker, evidence: ['unavailable.log']})
  f.bundle.reviews = f.resolved.payload.reviews
  const report = await evaluate(f, [f.selected, f.resolved], {rejectedEvidence: 'unavailable.log'})
  expect(report.exit_code).toBe(2)
  expect(report.reasons.some((r) => r.kind === 'failure')).toBe(false)
})
it.each([false, true])(
  'AC-32 a verifier sharing a historical/candidate review producer remains non-independent, outage=%s',
  async (outage) => {
    const f = producerFixture(),
      combined = f.make(780, 30, true)
    combined.payload.reviews = f.make(780, 30).payload.reviews
    Object.assign(combined.payload.verifier!.rows[0], {result: 'fail', exit_code: 1})
    f.bundle.reviews = f.selected.payload.reviews
    f.bundle.verifier = combined.payload.verifier
    const sources = [f.selected, combined],
      original = f.read(sources)
    const read: typeof githubJSON = async (context, endpoint) => {
      if (outage && endpoint.includes('?')) throw Error('Synthetic history503')
      return original(context, endpoint)
    }
    const report = await evaluate(f, [], {read, candidates: sources.map((s) => s.uri)})
    expect(report.exit_code).toBe(2)
    expect(report.reasons.some((r) => r.kind === 'failure')).toBe(false)
    expect(report.reasons.some((r) => r.subject === 'verifier' && r.message.includes('different producer'))).toBe(true)
  },
)
it.each([false, true])(
  'AC-32 invalid candidate selection blocks approval but cannot erase a valid selected blocker: %s',
  async (blocking) => {
    const f = producerFixture()
    if (blocking) f.selected.payload.reviews[0].findings.push({...f.blocker, evidence: [f.selected.uri]})
    f.bundle.reviews = f.selected.payload.reviews
    await writeFile(join(dir(), 'producers.json'), '{"not":"a selection array"}')
    const report = await evaluate(f, [f.selected])
    expect(report.exit_code).toBe(blocking ? 1 : 2)
    expect(report.reasons.some((r) => r.kind === 'failure')).toBe(blocking)
  },
)
it.each([
  'valid',
  'same-producer-primary',
  'unavailable-primary',
  'edited-sidecar',
  'no-valid-candidate',
  'stale-candidate',
] as const)('AC-32 candidate failure authority survives invalid routing primary: %s', async (mode) => {
  const f = producerFixture(),
    bad = f.make(780, 30, true),
    good = f.make(781, 40, true)
  Object.assign(bad.payload.verifier!.rows[0], {result: 'fail', exit_code: 1})
  bad.payload.verifier!.completion = 'unavailable'
  Object.assign(good.payload.verifier!.rows[1], {result: 'fail', exit_code: 1})
  let sources = [f.selected, bad, good]
  if (mode === 'same-producer-primary') {
    f.selected.payload.verifier = f.make(777, 0, true).payload.verifier
    Object.assign(f.selected.payload.verifier!.rows[0], {result: 'fail', exit_code: 1})
    sources = [f.selected, good]
    f.bundle.verifier = f.selected.payload.verifier
  } else f.bundle.verifier = mode === 'unavailable-primary' ? bad.payload.verifier : good.payload.verifier
  if (mode === 'no-valid-candidate') {
    sources = [f.selected, bad]
    f.bundle.verifier = bad.payload.verifier
  }
  if (mode === 'stale-candidate') {
    good.payload.verifier!.tested_sha = 'f'.repeat(40)
    f.bundle.verifier = bad.payload.verifier
  }
  for (const source of sources) for (const row of source.payload.verifier?.rows ?? []) row.evidence = [source.uri]
  if (mode === 'edited-sidecar') {
    f.bundle.verifier = structuredClone(good.payload.verifier)
    f.bundle.verifier!.rows[0].exit_code = 1
  }
  f.bundle.reviews = f.selected.payload.reviews
  const original = f.read(sources)
  const read: typeof githubJSON = async (context, endpoint) => {
    if (mode === 'unavailable-primary' && endpoint.endsWith('/780')) throw Error('Synthetic selected GET503')
    if (
      ['same-producer-primary', 'unavailable-primary', 'no-valid-candidate', 'stale-candidate'].includes(mode) &&
      endpoint.includes('?')
    )
      throw Error('Synthetic history503')
    return original(context, endpoint)
  }
  const report = await evaluate(f, [], {read, candidates: sources.map((s) => s.uri)})
  const known = !['no-valid-candidate', 'stale-candidate'].includes(mode)
  expect(report.exit_code).toBe(known ? 1 : 2)
  expect(report.reasons.some((r) => r.kind === 'failure' && r.subject === 'AC-2')).toBe(known)
  expect(report.reasons.some((r) => r.kind === 'failure' && r.subject === 'AC-1')).toBe(false)
})
it('AC-32 edited review sidecars cannot hide the authenticated provider blocker', async () => {
  const f = producerFixture()
  f.selected.payload.reviews[0].findings.push({...f.blocker, evidence: [f.selected.uri]})
  f.bundle.reviews = structuredClone(f.selected.payload.reviews)
  f.bundle.reviews[0].findings = []
  const report = await evaluate(f, [f.selected])
  expect(report.exit_code).toBe(1)
  expect(report.reasons.some((r) => r.kind === 'failure' && r.subject === `code/${f.blocker.id}`)).toBe(true)
  expect(report.reasons.some((r) => r.kind === 'blocked' && r.message.includes('exact structured verdict'))).toBe(true)
})
it.each([false, true])(
  'AC-32 verifier cannot reuse its own code producer when review sidecars are missing: %s',
  async (noReviews) => {
    const f = producerFixture(),
      combined = f.make(780, 30, true)
    combined.payload.reviews = f.make(780, 30).payload.reviews.filter((r) => r.role === 'code')
    Object.assign(combined.payload.verifier!.rows[0], {result: 'fail', exit_code: 1})
    f.bundle.reviews = noReviews ? [] : f.selected.payload.reviews.filter((r) => r.role === 'security')
    f.bundle.verifier = combined.payload.verifier
    const report = await evaluate(f, [f.selected, combined])
    expect(report.exit_code).toBe(2)
    expect(report.reasons.some((r) => r.kind === 'failure')).toBe(false)
  },
)
it('AC-32 forged review producer ID cannot suppress a genuinely independent verifier failure', async () => {
  const f = producerFixture(),
    failed = f.make(780, 30, true)
  Object.assign(failed.payload.verifier!.rows[1], {result: 'fail', exit_code: 1})
  const forged = structuredClone(f.selected.payload.reviews[0])
  forged.provenance = {...failed.payload.verifier!.provenance, producer_role: 'code'}
  f.bundle.reviews = [forged, f.selected.payload.reviews[1]]
  f.bundle.verifier = failed.payload.verifier
  const report = await evaluate(f, [f.selected, failed])
  expect(report.exit_code).toBe(1)
  expect(report.ac_results.find((r) => r.ac_id === 'AC-2')!.result).toBe('fail')
})
