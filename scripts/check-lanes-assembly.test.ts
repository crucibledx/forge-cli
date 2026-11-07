import {readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {expect, it} from 'bun:test'

import {assembleLane} from './check-lanes'
import {readEvidence, writeEvidence} from './evidence-io'
import {validationContext} from './validation-context'
import {checkEvidencePath} from './validation-evidence'
import {laneById} from './validation-lanes'
import {aggregateExit} from './validation-policy'
import {commandLog, commandMetadata} from './validation-process'

const dir = useTmpDir('lane-assembly')
const lane = laneById('quality')

async function fixture(siblingFailure: boolean) {
  const out = join(dir(), 'selected'),
    context = validationContext()
  const originals = new Map<string, string>()
  const partials = []
  for (const [index, check] of lane.checks.entries()) {
    const path = checkEvidencePath(lane.id, check.id)
    const exit_code = index === 0 || (index === 1 && siblingFailure) ? 1 : 0
    await writeEvidence(
      join(out, path),
      JSON.parse(
        commandLog(check.command, {
          ...commandMetadata(),
          exit_code,
          duration_ms: index + 1,
          timed_out: false,
          stdout: `original stdout ${check.id}`,
          stderr: `original stderr ${check.id}`,
        }),
      ),
      out,
    )
    const partial = {
      context,
      check: {
        id: check.id,
        command: check.command.join(' '),
        exit_code,
        duration_ms: index + 1,
        evidence: [path],
      },
    }
    await writeEvidence(join(out, path + '.json'), partial, out)
    originals.set(path, await readFile(join(out, path), 'utf8'))
    partials.push(partial)
  }
  return {out, context, originals, partials}
}

it.each(
  [
    'missing-check',
    'null-check',
    'array-check',
    'wrong-id',
    'wrong-command',
    'wrong-evidence',
    'extra-evidence',
    'negative-duration',
    'null-duration',
    'string-exit',
    'fractional-exit',
    'stale-context',
    'null-exit-no-reason',
    'extra-check-field',
    'invalid-json',
    'missing-sidecar',
  ].flatMap((kind) => [false, true].map((siblingFailure) => ({kind, siblingFailure}))),
)(
  'AC-25,27 assembly retains every original log and sibling for $kind, known sibling failure=$siblingFailure',
  async ({kind, siblingFailure}) => {
    const {out, context, originals, partials} = await fixture(siblingFailure)
    const initial = partials[0],
      path = initial.check.evidence[0] + '.json'
    const malformed: Record<string, unknown> = {
      'missing-check': {context},
      'null-check': {...initial, check: null},
      'array-check': {...initial, check: []},
      'wrong-id': {...initial, check: {...initial.check, id: 'lint'}},
      'wrong-command': {...initial, check: {...initial.check, command: 'bun run lint'}},
      'wrong-evidence': {...initial, check: {...initial.check, evidence: ['checks/quality/lint.log']}},
      'extra-evidence': {...initial, check: {...initial.check, evidence: [...initial.check.evidence, 'other.log']}},
      'negative-duration': {...initial, check: {...initial.check, duration_ms: -1}},
      'null-duration': {...initial, check: {...initial.check, duration_ms: null}},
      'string-exit': {...initial, check: {...initial.check, exit_code: '1'}},
      'fractional-exit': {...initial, check: {...initial.check, exit_code: 0.5}},
      'stale-context': {...initial, context: {...context, run_attempt: context.run_attempt + 1}},
      'null-exit-no-reason': {...initial, check: {...initial.check, exit_code: null}},
      'extra-check-field': {...initial, check: {...initial.check, unexpected: true}},
    }
    if (kind === 'missing-sidecar') {
      const {unlink} = await import('node:fs/promises')
      await unlink(join(out, path))
    } else await writeFile(join(out, path), kind === 'invalid-json' ? '{incomplete' : JSON.stringify(malformed[kind]))
    const beforePartial = kind === 'missing-sidecar' ? null : await readFile(join(out, path), 'utf8')
    const report = await assembleLane(out, context, lane, Bun.version)
    expect(report.checks).toHaveLength(3)
    expect(report.checks.map((check) => check.id)).toEqual(lane.checks.map((check) => check.id))
    expect(report.checks[0]).toMatchObject({
      id: initial.check.id,
      exit_code: null,
      duration_ms: 0,
      evidence: initial.check.evidence,
      reason: 'Missing/invalid independent check result',
    })
    expect(report.checks[1]).toEqual(partials[1].check)
    expect(report.checks[2]).toEqual(partials[2].check)
    expect(report.duration_ms).toBe(5)
    expect(report.status).toBe(siblingFailure ? 'fail' : 'blocked')
    expect(aggregateExit([report])).toBe(siblingFailure ? 1 : 2)
    expect(JSON.parse(await readEvidence(out, 'quality.json'))).toEqual(report)
    for (const [raw, original] of originals) expect(await readFile(join(out, raw), 'utf8')).toBe(original)
    if (beforePartial !== null) expect(await readFile(join(out, path), 'utf8')).toBe(beforePartial)
    else await expect(readFile(join(out, path))).rejects.toMatchObject({code: 'ENOENT'})
  },
)
it('AC-25,27 assembly creates bounded blocked evidence only when the raw log is genuinely absent', async () => {
  const out = join(dir(), 'empty'),
    context = validationContext()
  const report = await assembleLane(out, context, lane, Bun.version)
  expect(report.status).toBe('blocked')
  expect(report.checks).toHaveLength(3)
  expect(aggregateExit([report])).toBe(2)
  for (const check of report.checks) {
    const raw = await readEvidence(out, check.evidence[0])
    expect(Buffer.byteLength(raw)).toBeLessThan(4096)
    expect(JSON.parse(raw)).toMatchObject({
      command: lane.checks.find((expected) => expected.id === check.id)!.command,
      exit_code: null,
      duration_ms: 0,
      stdout: '',
      stderr: '',
      reason: 'Missing/invalid independent check result',
    })
  }
})
it('AC-25,27 valid assembly preserves original failed outcomes and every raw/partial byte', async () => {
  const {out, context, originals, partials} = await fixture(false)
  const report = await assembleLane(out, context, lane, Bun.version)
  expect(report.status).toBe('fail')
  expect(aggregateExit([report])).toBe(1)
  expect(report.checks).toEqual(partials.map((partial) => partial.check))
  expect(report.duration_ms).toBe(6)
  for (const [raw, original] of originals) {
    expect(await readFile(join(out, raw), 'utf8')).toBe(original)
    expect(JSON.parse(await readFile(join(out, raw + '.json'), 'utf8'))).toEqual(
      partials.find((partial) => partial.check.evidence[0] === raw),
    )
  }
})
