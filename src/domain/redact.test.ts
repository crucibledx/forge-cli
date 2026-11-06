import {expect, it} from 'bun:test'

import {redact, redactData} from './redact'

it.each([
  ['Bearer prefixKNOWNSECRET_ACTUAL_CREDENTIAL_SUFFIX', 'KNOWNSECRET'],
  ['https://fixture.invalid?token=ACTUAL_CREDENTIAL_SUFFIX', 'token'],
  ['https://user:KNOWNSECRET_ACTUAL_CREDENTIAL_SUFFIX@fixture.invalid', 'KNOWNSECRET'],
])('AC-15 independent explicit-secret spans cannot interrupt credentials: %s', (value, secret) => {
  expect(redact(value, {secrets: [secret]})).not.toContain('ACTUAL_CREDENTIAL_SUFFIX')
})
it.each([
  ['PREFIX', 'PREFIX.VISIBLE_SUFFIX'],
  ['PREFIX.VISIBLE_SUFFIX', 'PREFIX'],
])('AC-15 nested explicit secrets mask their union regardless of order: %s', (first, second) => {
  expect(redact('before PREFIX.VISIBLE_SUFFIX after', {secrets: [first, second]})).toBe('before [redacted] after')
})
it('AC-15 overlapping explicit-secret occurrences form one protected span', () => {
  expect(redact('before ababa after', {secrets: ['aba', 'bab']})).toBe('before [redacted] after')
})

it.each(['token', 'access_token', 'password', 'secret', 'key', 'auth'])(
  'AC-15 redacts apostrophes within query credentials: %s',
  (key) => {
    for (const quote of ['', "'"])
      expect(redact(`${quote}https://fixture.invalid/repo?${key}=prefix'QUERY_SUFFIX${quote}`)).not.toContain(
        'QUERY_SUFFIX',
      )
    expect(redact(`https://fixture.invalid?${key}=prefix'QUERY_SUFFIX&visible=yes`)).toEndWith('&visible=yes')
  },
)

it('leaves a long invalid scheme candidate unchanged without rescanning every internal word boundary', () => {
  const input = 'a-'.repeat(50000)
  expect(redact(input)).toBe(input)
})

it.each(['http', 'https', 'ssh', 'ftp', 'ftps', 'git', 'git+ssh', 'CUSTOM.v1+transport'])(
  'redacts URI userinfo independently of Git transport: %s (C4, AC-15)',
  (scheme) => {
    const url = `${scheme}://user:credential-sentinel@fixture.invalid/repo?token=query-sentinel`
    expect(redact(`nested cause: ${url}`)).toBe(
      `nested cause: ${scheme}://[redacted]@fixture.invalid/repo?token=[redacted]`,
    )
    expect(JSON.stringify(redactData({error: {cause: url}}))).not.toContain('sentinel')
  },
)
it('redacts userinfo through its last authority @ and leaves credential-free URLs/path data intact', () => {
  expect(redact('ftps://user:credential@sentinel@fixture.invalid/repo')).toBe('ftps://[redacted]@fixture.invalid/repo')
  expect(redact('git+ssh://fixture.invalid/repo/name@example.md')).toBe(
    'git+ssh://fixture.invalid/repo/name@example.md',
  )
})
