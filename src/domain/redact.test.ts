import {expect, it} from 'bun:test'

import {
  diagnosticAuthoritySpans,
  redact,
  redactData,
  redactionContext,
  redactionSecretPrefix,
  redactionSpans,
} from './redact'

it.each([
  'Basic PRIVATE_CREDENTIAL_Q',
  'Authorization: Basic PRIVATE_CREDENTIAL_Q',
  'Proxy-Authorization: Basic PRIVATE_CREDENTIAL_Q',
  'authorization : Bearer "prefix PRIVATE_CREDENTIAL_Q suffix"',
  'password=PRIVATE_CREDENTIAL_Q',
  'client_secret="prefix PRIVATE_CREDENTIAL_Q suffix"',
  'api_key="prefix\\"PRIVATE_CREDENTIAL_Q suffix"',
  "passwd : 'prefix PRIVATE_CREDENTIAL_Q suffix'",
  '%73ig=PRIVATE_CREDENTIAL_Q',
  'remote: {"access_token":"PRIVATE_CREDENTIAL_Q"}',
  'remote: {"client secret":"prefix PRIVATE_CREDENTIAL_Q suffix"}',
  'remote: {"access_\\u0074oken":"PRIVATE_CREDENTIAL_Q"}',
  'remote: {"api%5fkey":"PRIVATE_CREDENTIAL_Q"}',
  'remote: {"access_token"\n:\n  "PRIVATE_CREDENTIAL_Q"}',
  'remote: {"client\'s_secret":"PRIVATE_CREDENTIAL_Q"}',
  "remote: {'password' = 'PRIVATE_CREDENTIAL_Q'}",
])('AC-15,30 production diagnostic credentials remain private at every context cut: %s', (value) => {
  const secret = 'PRIVATE_CREDENTIAL_Q'
  const input = value + '\nvisible=yes'
  expect(redact(input)).not.toContain(secret)
  expect(JSON.stringify(redactData({cause: input}))).not.toContain(secret)
  for (let cut = 0; cut <= input.length; cut++) {
    const output = redact(input.slice(cut), {credentialPrefixes: redactionContext(input.slice(0, cut))})
    const surviving = secret.slice(Math.max(0, cut - input.indexOf(secret)))
    if (surviving) expect({cut, leaked: output.includes(surviving)}).toEqual({cut, leaked: false})
    if (cut <= input.indexOf('visible=yes')) expect(output).toContain('visible=yes')
  }
})
it.each([
  'https://fixture.invalid?contact=user@example.invalid&visible=yes',
  'https://fixture.invalid#contact=user@example.invalid&visible=yes',
  'https://fixture.invalid/repo?contact=user@example.invalid&visible=yes',
  'https://fixture.invalid?contact=one@a.invalid&other=two@b.invalid',
])('AC-15,30 query/fragment email addresses are public, never URI userinfo: %s', (input) => {
  expect(redact(input)).toBe(input)
  for (let cut = 0; cut <= input.length; cut++)
    expect(redact(input.slice(cut), {credentialPrefixes: redactionContext(input.slice(0, cut))})).toBe(input.slice(cut))
  const privateURL = input.replace('https://', 'https://user:PRIVATE_CREDENTIAL_Q@')
  expect(redact(privateURL)).toBe(input.replace('https://', 'https://[redacted]@'))
})
it.each(['design', 'signal', 'signed_at', 'foosig'])(
  'AC-15,30 ordinary assignment %s is not a short-alias credential',
  (key) => {
    const input = `${key}=PUBLIC_VALUE\nvisible=yes`
    for (let cut = 0; cut <= input.length; cut++)
      expect(redact(input.slice(cut), {credentialPrefixes: redactionContext(input.slice(0, cut))})).toBe(
        input.slice(cut),
      )
  },
)
it.each(['design', 'signal', 'signed_at', 'foosig'])(
  'AC-15,30 quoted ordinary key %s stays public at every cut',
  (key) => {
    const input = `{"${key}":"PUBLIC_VALUE"}\nvisible=yes`
    for (let cut = 0; cut <= input.length; cut++)
      expect(redact(input.slice(cut), {credentialPrefixes: redactionContext(input.slice(0, cut))})).toBe(
        input.slice(cut),
      )
  },
)

it.each([
  'ordinary ' + 'x'.repeat(262144),
  'https://user:private@fixture.invalid/path\n' + 'x'.repeat(4096),
  'https://first:a@one.invalid/path https://second:b@two.invalid/path',
  'https://user:a@host@last/path',
  'broken://user@host\nordinary@fixture',
  'https://fixture.invalid/no-userinfo/path @elsewhere',
  'https://user:unfinished' + 'x'.repeat(128),
  'https://fixture.invalid?visible=yes&other=public',
])('AC-15,30 literal-bounded URI scans equal the original full-input recognizers: %#', (input) => {
  const userinfo = [...input.matchAll(/(?<![a-z\d+.-])([a-z][a-z\d+.-]*:\/\/)[^\s/]+@/gi)].map((match) => ({
    start: match.index + match[1].length,
    end: match.index + match[0].length - 1,
  }))
  expect(redactionSpans(input)).toEqual(userinfo)
  const pending: {start: number; end: number}[] = [],
    resolved: {start: number; end: number}[] = []
  let continuing = false
  for (const match of input.matchAll(/(?<![a-z\d+.-])[a-z][a-z\d+.-]*:\/\//gi)) {
    const start = match.index + match[0].length
    let end = start
    while (end < input.length && !/[/?#\s\p{Cc}]/u.test(input[end])) end++
    continuing ||= end === input.length
    if (end > start) (end < input.length && '/?#'.includes(input[end]) ? resolved : pending).push({start, end})
  }
  expect(diagnosticAuthoritySpans(input)).toEqual({pending, resolved, continuing})
})

it.each([
  'private_token',
  'client_secret',
  'api_key',
  'oauthToken',
  'signing-key',
  'nested.session.id',
  'providerCredential',
  'sig',
  'SIG',
  'sIg',
])('AC-15,30 compound credential query names survive no plain/encoded stream boundary: %s', (key) => {
  const secret = 'COMPOUND_QUERY_PRIVATE'
  for (const name of [key, [...key].map((char) => '%' + char.charCodeAt(0).toString(16)).join('')]) {
    const input = `https://fixture.invalid?${name}=${secret}&visible=yes`
    expect(redact(input)).toBe(input.replace(secret, '[redacted]'))
    expect(redactData({url: input, [key]: secret})).toEqual({
      url: input.replace(secret, '[redacted]'),
      [key]: '[redacted]',
    })
    const secretStart = input.indexOf(secret),
      secretEnd = secretStart + secret.length
    for (let cut = 0; cut < secretEnd; cut++) {
      const spans = redactionSpans(input.slice(cut), {credentialPrefixes: redactionContext(input.slice(0, cut))})
      expect(spans.some((span) => span.start <= Math.max(0, secretStart - cut) && span.end >= secretEnd - cut)).toBe(
        true,
      )
    }
  }
  const prefix = '?' + 'provider_'.repeat(10000) + 'tok%6'
  const contexts = redactionContext(prefix)
  expect(contexts.every((value) => value.length < 128)).toBe(true)
  expect(redact('5n=' + secret + '&visible=yes', {credentialPrefixes: contexts})).toBe('5n=[redacted]&visible=yes')
})
it('AC-15,30 a public redirect value cannot conceal a nested credential query', () => {
  expect(
    redact('https://fixture.invalid?redirect=https://nested.invalid?client_secret=NESTED_PRIVATE&visible=yes'),
  ).toBe('https://fixture.invalid?redirect=https://nested.invalid?client_secret=[redacted]&visible=yes')
})

it.each(['design', 'signal', 'signed_at'])('AC-15,30 the short SAS alias does not hide public %s data', (key) => {
  for (const name of [key, [...key].map((char) => '%' + char.charCodeAt(0).toString(16)).join('')]) {
    const input = `https://fixture.invalid?${name}=PUBLIC_VALUE&visible=yes`
    expect(redactData({[name]: 'PUBLIC_VALUE'})).toEqual({[name]: 'PUBLIC_VALUE'})
    for (let cut = 0; cut < input.length; cut++)
      expect(redact(input.slice(cut), {credentialPrefixes: redactionContext(input.slice(0, cut))})).toBe(
        input.slice(cut),
      )
  }
})

it('AC-15,18,30 known-secret matching and eviction state agree with an independent overlapping-prefix oracle', () => {
  const values = ['']
  for (let size = 1; size <= 4; size++)
    for (let bits = 0; bits < 2 ** size; bits++)
      values.push(bits.toString(2).padStart(size, '0').replaceAll('0', 'a').replaceAll('1', 'b'))
  const secrets = ['a', 'aa', 'ab', 'aba', 'aab', 'abab', 'aaaaZ']
  for (const prefix of [...values, 'λ😀λ', '😀λ😀', 'ababababab']) {
    let suffix = ''
    for (const secret of secrets)
      for (let size = 1; size < secret.length && size <= prefix.length; size++)
        if (prefix.endsWith(secret.slice(0, size)) && size > suffix.length) suffix = secret.slice(0, size)
    expect(redactionSecretPrefix(prefix, [...secrets, ''])).toBe(suffix)
    for (const text of values)
      for (const secret of secrets) {
        const expected = new Set<number>(),
          input = prefix + text
        for (let at = 0; at < input.length; at++)
          if (input.slice(at, at + secret.length) === secret)
            for (
              let index = Math.max(0, at - prefix.length);
              index < Math.min(text.length, at + secret.length - prefix.length);
              index++
            )
              expected.add(index)
        for (let size = 1; size < secret.length && size <= prefix.length; size++)
          if (prefix.endsWith(secret.slice(0, size)) && secret.slice(size).startsWith(text))
            for (let index = 0; index < text.length; index++) expected.add(index)
        const actual = redactionSpans(text, {secretPrefix: prefix, secrets: [secret]}).flatMap(({start, end}) =>
          Array.from({length: end - start}, (_, index) => start + index),
        )
        expect(actual).toEqual([...expected].sort((a, b) => a - b))
      }
  }
})

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

it.each(['token', 'access_token', 'password', 'secret', 'key', 'auth'])(
  'AC-15,30 double quotes never terminate a query credential or its streaming continuation: %s',
  (key) => {
    const input = `before https://fixture.invalid/repo?${key}=prefix"DOUBLE_QUOTE_SUFFIX&visible=yes\nordinary-after`
    for (const output of [redact(input), JSON.stringify(redactData({cause: input}))]) {
      expect(output).not.toContain('DOUBLE_QUOTE_SUFFIX')
      expect(output).toContain('&visible=yes')
      expect(output).toContain('ordinary-after')
    }
    expect(
      redact('DOUBLE_QUOTE_SUFFIX', {
        credentialPrefixes: redactionContext(`?${key}=prefix"`),
      }),
    ).toBe('[redacted]')
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
