import {expect, it} from 'bun:test'

import {assessAudit} from './security-audit'

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
it.each(['high', 'critical'].flatMap((severity) => [0, 1].map((exit_code) => ({severity, exit_code}))))(
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
    expect(report).toHaveProperty('diagnostic', 'Skipped unaudited package')
  },
)
it('AC-30 accepts an explicit complete empty advisory result without changing dependency policy', () => {
  expect(assessAudit(clean, true).status).toBe('pass')
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
