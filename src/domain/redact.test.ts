import {expect, it} from 'bun:test'

import {redact, redactData, redactionContext} from './redact'

it.each([
  'https://user:X_PRODUCTION_PRIVATE',
  'https://X_PRODUCTION_PRIVATE',
  'https://fixture.invalid?to\x1b[31mken=X_PRODUCTION_PRIVATE&visible=yes',
  'https://fixture.invalid?to\x9b31mken=X_PRODUCTION_PRIVATE&visible=yes',
])('AC-15,30 production redaction masks unfinished/formatted credentials: %s', (value) => {
  const input = 'ordinary-before\n' + value + '\nordinary-after'
  for (const output of [redact(input), JSON.stringify(redactData({error: {cause: input}}))]) {
    expect(output).not.toContain('X_PRODUCTION_PRIVATE')
    expect(output).toContain('ordinary-before')
    expect(output).toContain('ordinary-after')
    if (value.includes('visible=yes')) expect(output).toContain('visible=yes')
  }
})
it.each(['access_token', 'token', 'password', 'secret', 'key', 'auth'])(
  'AC-15,30 encoded credential query names keep surrounding diagnostics: %s',
  (key) => {
    const encode = (value: string) => [...value].map((char) => '%' + char.charCodeAt(0).toString(16)).join('')
    for (const name of [
      encode(key),
      encode(key.toUpperCase()),
      encode(key[0]) + key.slice(1),
      [...key].map((char, i) => (i % 2 ? char : encode(char))).join(''),
    ]) {
      expect(new URLSearchParams(`${name}=value`).keys().next().value?.toLowerCase()).toBe(key)
      for (const separator of ['?', '&', '#']) {
        const input = `diagnostic https://fixture.invalid/repo${separator}${name}=ENCODED_QUERY_SENTINEL&visible=yes`
        const expected = input.replace('ENCODED_QUERY_SENTINEL', '[redacted]')
        expect(redact(input)).toBe(expected)
        expect(redactData({error: {cause: input}})).toEqual({error: {cause: expected}})
      }
    }
    expect(redact('https://fixture.invalid?%6cogin=visible')).toContain('%6cogin=visible')
  },
)

it('AC-15 URI-scheme continuation remains independent of concurrent Bearer context', () => {
  expect(
    redact('456://user:VISIBLE_SECRET@fixture.invalid', {
      credentialPrefixes: redactionContext('Bearer custom123'),
    }),
  ).toBe('[redacted]://[redacted]@fixture.invalid')
})

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
