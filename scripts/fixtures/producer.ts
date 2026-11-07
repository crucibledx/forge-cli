import {createHash} from 'node:crypto'

import {readinessFixture} from './readiness'

export function producerFixture() {
  const bundle = readinessFixture()
  const make = (id: number, second: number, verifierOnly = false) => {
    const uri = `https://github.com/crucibledx/forge-cli/pull/99#pullrequestreview-${id}`
    const payload = {
      raw_report_markdown: `Independent report ${id}`,
      reviews: verifierOnly ? [] : structuredClone(bundle.reviews),
      verifier: verifierOnly ? structuredClone(bundle.verifier) : null,
    }
    const time = `2026-11-04T12:00:${String(second).padStart(2, '0')}.000Z`
    for (const record of [...payload.reviews, ...(payload.verifier ? [payload.verifier] : [])])
      Object.assign(record.provenance, {
        actor: 'factory-droid[bot]',
        producer_id: String(id),
        source_uri: uri,
        report_sha256: createHash('sha256').update(payload.raw_report_markdown).digest('hex'),
        completed_at: time,
      })
    const review = {
      id,
      user: {login: 'factory-droid[bot]', type: 'Bot'},
      commit_id: bundle.context.head_sha,
      submitted_at: time,
      state: 'COMMENTED',
      html_url: uri,
      body: '',
    }
    return {payload, review, uri}
  }
  const selected = make(777, 0),
    later = make(778, 10),
    resolved = make(779, 20)
  const blocker = {
    id: 'later-blocker',
    severity: 'blocking' as const,
    status: 'open' as const,
    evidence: ['fixtures/check.log'],
  }
  later.payload.reviews[0].findings.push(blocker)
  const read = (sources = [selected, later, resolved], metadata: unknown[] = []) => {
    for (const source of sources)
      source.review.body = '```forge-evidence-v1\n' + JSON.stringify(source.payload) + '\n```'
    const items = [...metadata, ...sources.map((source) => source.review)]
    return async (_context: unknown, endpoint: string): Promise<unknown> => {
      if (endpoint.includes('?')) {
        const page = Number(new URL('https://fixture.invalid' + endpoint).searchParams.get('page') ?? 1)
        return items.slice((page - 1) * 100, page * 100)
      }
      const found = sources.find((source) => endpoint.endsWith('/' + source.review.id))
      if (!found) throw Error('Unknown fixture review')
      return found.review
    }
  }
  return {bundle, make, selected, later, resolved, blocker, read}
}
