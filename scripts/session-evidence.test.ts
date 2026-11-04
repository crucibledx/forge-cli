import {createHash} from 'node:crypto'
import {mkdir, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {expect, it} from 'bun:test'

import {readinessFixture} from './fixtures/readiness'
import {sessionProducer} from './session-evidence'

const dir = useTmpDir('producer')
it.each(['valid', 'worker', 'edited-sidecar', 'wrong-parent', 'incomplete', 'markdown-only'])(
  'AC-32 authenticates provider session metadata and explicit producer payload: %s',
  async (kind) => {
    const parent = '11111111-1111-4111-8111-111111111111',
      child = '22222222-2222-4222-8222-222222222222'
    const review = readinessFixture().reviews[0],
      markdown = 'Independent code and security findings, synthetic provider only.'
    review.provenance.producer_id = child
    review.provenance.report_sha256 = createHash('sha256').update(markdown).digest('hex')
    if (kind === 'edited-sidecar') review.provenance.report_sha256 = 'f'.repeat(64)
    await mkdir(join(dir(), 'scope'))
    const payload = {raw_report_markdown: markdown, reviews: [review], verifier: null}
    const rows = [
      {
        type: 'session_start',
        id: child,
        owner: 'independent-fixture',
        callingSessionId: kind === 'wrong-parent' ? child : parent,
        callingToolUseId: 'task-1',
      },
      {type: 'message', timestamp: '2026-11-04T11:59:00.000Z', message: {role: 'user', content: []}},
      {
        type: 'message',
        timestamp: '2026-11-04T12:00:00.000Z',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'text',
              text:
                kind === 'markdown-only' ? 'Looks ready' : '```forge-evidence-v1\n' + JSON.stringify(payload) + '\n```',
            },
          ],
        },
      },
      {type: 'agent_turn_outcome', reason: kind === 'incomplete' ? 'interrupted' : 'completed'},
    ]
    await writeFile(join(dir(), 'scope', `${child}.jsonl`), rows.map((row) => JSON.stringify(row)).join('\n'))
    await writeFile(
      join(dir(), 'scope', `${parent}.jsonl`),
      JSON.stringify({
        type: 'message',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'task-1',
              name: 'Task',
              input: {subagent_type: kind === 'worker' ? 'worker' : 'code-reviewer'},
            },
          ],
        },
      }),
    )
    const result = sessionProducer(review.provenance.source_uri, dir())
    if (kind === 'valid') expect((await result).reviews).toEqual([review])
    else await expect(result).rejects.toThrow()
  },
)
