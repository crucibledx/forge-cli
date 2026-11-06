import {expect, it} from 'bun:test'

import {redact, redactData} from './redact'

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
