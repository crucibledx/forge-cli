import {expect, it} from 'bun:test'

import type {spawnOwnedPipe} from '../e2e/framework/owned-pipe'
import {assessAudit} from './security-audit'
import {createTestSandbox} from './test-sandbox'
import {executeCheck} from './validation-process'

const clean = {
  signal: null,
  cwd: '.',
  seed: null,
  replay: null,
  exit_code: 0,
  duration_ms: 1,
  timed_out: false,
  stdout: '{}',
  stderr: '',
}
it.each(
  ['keyv', 'path-key', 'eslint-visitor-keys'].flatMap((name) =>
    ['moderate', 'high', 'critical'].map((severity) => ({name, severity})),
  ),
)('AC-30 structured $severity audit for $name is not parsed from redacted diagnostics', async ({name, severity}) => {
  const input = JSON.stringify({
    [name]: [
      {
        id: 1,
        url: 'https://github.com/advisories/GHSA-abcd-1234-5678',
        title: 'fixture advisory https://user:ADVISORY_PRIVATE_Q@fixture.invalid/path',
        severity,
        vulnerable_versions: '*',
        cwe: [],
        cvss: {score: 9, vectorString: null},
      },
    ],
  })
  const stream = (value: string) =>
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(Buffer.from(value))
        controller.close()
      },
    })
  const response: {data?: unknown} = {}
  const result = await executeCheck(
    ['fixture-audit'],
    5000,
    {
      createSandbox: createTestSandbox,
      spawn: async () =>
        ({
          exited: Promise.resolve(severity === 'moderate' ? 0 : 1),
          signalCode: null,
          stdout: stream(input),
          stderr: stream(''),
        }) as unknown as Awaited<ReturnType<typeof spawnOwnedPipe>>,
      terminate: async () => {},
    },
    response,
  )
  expect(result.stdout).not.toContain('ADVISORY_PRIVATE_Q')
  const report = assessAudit(result, true, response)
  expect(report.status).toBe(severity === 'moderate' ? 'pass' : 'fail')
  expect(report.exit_code).toBe(severity === 'moderate' ? 0 : 1)
  expect(JSON.stringify(report)).not.toContain('ADVISORY_PRIVATE_Q')
  if (severity === 'moderate') expect(report).toHaveProperty(`advisory_data.${name}`)
  else
    expect(report).toHaveProperty('advisories', [
      {
        package: name,
        id: 1,
        severity,
        url: 'https://github.com/advisories/GHSA-abcd-1234-5678',
      },
    ])
})
it.each(['high', 'critical'].flatMap((severity) => [0, 1, null].map((exit_code) => ({severity, exit_code}))))(
  'AC-30 known $severity advisory keeps failure precedence with warnings and exit $exit_code',
  ({severity, exit_code}) => {
    const stdout = JSON.stringify({
      'dev-only': [
        {
          id: 1,
          url: 'https://github.com/advisories/GHSA-abcd-1234-5678',
          title: 'test',
          severity,
          vulnerable_versions: '*',
          cwe: [],
          cvss: {score: 9, vectorString: null},
        },
      ],
    })
    const report = assessAudit({...clean, stdout, exit_code, stderr: 'Skipped unaudited package'}, true)
    expect(report.status).toBe('fail')
    expect(report.exit_code).toBe(1)
    expect(report).toHaveProperty(
      'diagnostic',
      'Skipped unaudited package' + (exit_code === null ? '; Process exit unavailable' : ''),
    )
  },
)
it('AC-30 accepts an explicit complete empty advisory result without changing dependency policy', () => {
  expect(assessAudit(clean, true).status).toBe('pass')
})
it.each(
  ['high', 'critical'].flatMap((severity) =>
    [false, true].flatMap((timed_out) => [1, null].map((exit_code) => ({severity, timed_out, exit_code}))),
  ),
)(
  'AC-30 observed $severity audit failure survives lifecycle diagnostics, timed_out=$timed_out, exit=$exit_code',
  ({severity, timed_out, exit_code}) => {
    const stdout = JSON.stringify({
      'dev-only': [
        {
          id: 1,
          url: 'https://github.com/advisories/GHSA-abcd-1234-5678',
          title: 'fixture advisory',
          severity,
          vulnerable_versions: '*',
          cwe: [],
          cvss: {score: 9, vectorString: null},
        },
      ],
    })
    const result = assessAudit(
      {...clean, stdout, exit_code, timed_out, reason: 'Cleanup failed: fixture EBUSY', stderr: 'fixture warning'},
      true,
    )
    expect(result).toMatchObject({status: 'fail', exit_code: 1})
    expect(result).toHaveProperty(
      'diagnostic',
      'Cleanup failed: fixture EBUSY; fixture warning' + (exit_code === null ? '; Process exit unavailable' : ''),
    )
  },
)
it('AC-30 lifecycle incompleteness still blocks an otherwise clean audit', () => {
  expect(assessAudit({...clean, reason: 'Cleanup failed: fixture EBUSY'}, true).status).toBe('blocked')
})
it.each(['high', 'critical'])('AC-30 blocks %s advisories in any package, including dev dependencies', (severity) => {
  const stdout = JSON.stringify({
    'dev-only': [
      {
        id: 1,
        url: 'https://github.com/advisories/GHSA-abcd-1234-5678',
        title: 'test',
        severity,
        vulnerable_versions: '*',
        cwe: [],
        cvss: {score: 9, vectorString: null},
      },
    ],
  })
  expect(assessAudit({...clean, stdout, exit_code: 1}, true).status).toBe('fail')
})
it.each([
  {...clean, stdout: ''},
  {...clean, stdout: '{"unaudited":["private-package"]}'},
  {...clean, stderr: 'Skipped unaudited package'},
  {...clean, exit_code: 1},
  {...clean, timed_out: true},
  {...clean, exit_code: null},
  {...clean, stdout: 'not JSON'},
])('AC-30 never treats unavailable/invalid/unaudited output as a clean audit %#', (result) => {
  expect(assessAudit(result, true).status).toBe('blocked')
})
it('AC-30 rejects a changed lockfile even when advisory output is clean', () => {
  expect(assessAudit(clean, false).status).toBe('blocked')
})
