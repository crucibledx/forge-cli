import {expect, it} from 'bun:test'
import {parse} from 'yaml'

import {
  diagnosticAuthoritySpans,
  redact,
  redactData,
  redactionContext,
  redactionSecretPrefix,
  redactionSpans,
} from './redact'

it.each([false, true, null, 0, 17, -12.5, 6e24])(
  'AC-15 typed JSON credential scalar %j preserves public sibling diagnostics',
  (token) => {
    const input = JSON.stringify({
      token,
      path: '/public/recovery-target.md',
      password: 'JSON_PRIVATE_Q',
      error: 'PUBLIC_SPECIFIC_RECOVERY_Q: fix file permissions',
    })
    for (const output of [redact(input), redact(redact(input)), JSON.stringify(redactData({cause: input}))]) {
      expect(output).toContain('/public/recovery-target.md')
      expect(output).toContain('PUBLIC_SPECIFIC_RECOVERY_Q')
      expect(output).not.toContain('JSON_PRIVATE_Q')
    }
  },
)
it.each([
  '"token": false,JSON_PRIVATE_Q',
  'prefix, "token": false,JSON_PRIVATE_Q',
  '{"token":false,JSON_PRIVATE_Q}',
  '{"token":falseJSON_PRIVATE_Q,"path":"public"}',
  '{"token":"false,JSON_PRIVATE_Q","path":"public"}',
  'token=false,JSON_PRIVATE_Q',
  'token: false,JSON_PRIVATE_Q',
])('AC-15,30 JSON-looking string credentials remain private: %j', (input) => {
  expect(redact(input)).not.toContain('JSON_PRIVATE_Q')
})

it.each([
  'password=[]SCALAR_PRIVATE_Q',
  'password={x}SCALAR_PRIVATE_Q',
  'password=[],SCALAR_PRIVATE_Q',
  'password={x},SCALAR_PRIVATE_Q',
  'password: []SCALAR_PRIVATE_Q',
  'password: {x}SCALAR_PRIVATE_Q',
  String.raw`api_keys: ['a\', ']SCALAR_PRIVATE_Q']`,
  String.raw`api_keys: ['a\', 'SCALAR_PRIVATE_Q']`,
  String.raw`api_keys: ['a''SCALAR_PRIVATE_Q]still', 'next']`,
  String.raw`api_keys: {'value': 'a\', 'other': '}SCALAR_PRIVATE_Q'}`,
])('AC-15,30 scalar prefixes and YAML flow quotes remain private at every retained cut: %j', (value) => {
  const secret = 'SCALAR_PRIVATE_Q'
  const input = value + '\npublic: repository not found'
  if (value.startsWith('api_keys:')) expect(parse(input).public).toBe('repository not found')
  for (const output of [redact(input), redact(redact(input)), JSON.stringify(redactData({cause: input}))]) {
    expect(output).not.toContain(secret)
    expect(output).toContain('repository not found')
  }
  for (const size of [0, 1, 3, 7]) {
    let contexts: string[] = []
    for (let cut = 0; cut <= input.length; cut += size || 1) {
      contexts = size
        ? redactionContext(input.slice(Math.max(0, cut - size), cut), contexts)
        : redactionContext(input.slice(0, cut))
      const output = redact(input.slice(cut), {credentialPrefixes: contexts})
      const surviving = secret.slice(Math.max(0, cut - input.indexOf(secret)))
      if (surviving) expect({size, cut, leaked: output.includes(surviving)}).toEqual({size, cut, leaked: false})
      if (cut <= input.indexOf('repository not found')) expect(output).toContain('repository not found')
      expect(contexts.length).toBeLessThan(32)
      expect(contexts.every((context) => context.length < 128 && !context.includes(secret))).toBe(true)
    }
  }
})

const controlStrings = ['\x1bP', '\x1b_', '\x1b^', '\x1bX', '\u0090', '\u009f', '\u009e', '\u0098'].map(
  (open, label) => ({open, label}),
)
it.each(controlStrings)(
  'AC-15,30 invisible control-string payloads cannot break credential names: form $label',
  ({open}) => {
    const close = open.startsWith('\x1b') ? '\x1b\\' : '\u009c'
    const input = `https://fixture.invalid?to${open}junk${close}ken=CONTROL_PRIVATE_Q&visible=yes`
    for (const output of [redact(input), redact(redact(input)), JSON.stringify(redactData({cause: input}))]) {
      expect(output).not.toContain('CONTROL_PRIVATE_Q')
      expect(output).toContain('visible=yes')
    }
  },
)
it.each(
  [...controlStrings, {open: '\x1b]', label: 8}, {open: '\u009d', label: 9}, {open: '', label: 10}].flatMap(
    ({open, label}) => ['\x18', '\x1a'].map((cancel, kind) => ({open, cancel, label: `${label}/${kind}`})),
  ),
)('AC-15,30 cancelled control strings cannot expose raw credentials: $label', ({open, cancel}) => {
  const input = `https://fixture.invalid?to${open}${open ? 'junk' : ''}${cancel}ken=CANCEL_PRIVATE_Q&visible=yes`
  for (const output of [redact(input), redact(redact(input)), JSON.stringify(redactData({cause: input}))]) {
    expect(output).not.toContain('CANCEL_PRIVATE_Q')
    expect(output).toContain('visible=yes')
  }
})
it.each(
  ['\n', '\r', '\r\n'].flatMap((newline) =>
    ['array', 'object', 'plain-hash', 'quoted-hash'].map((kind) => ({newline, kind})),
  ),
)('AC-15,30 YAML comments preserve credential boundaries across every cut: $kind %#', ({newline, kind}) => {
  const value =
    kind === 'array'
      ? '[first, # ] } "\'\n  COMMENT_PRIVATE_Q\n]'
      : kind === 'object'
        ? '{first: ok, # } ] "\'\n  next: COMMENT_PRIVATE_Q\n}'
        : kind === 'plain-hash'
          ? '[first#literal, COMMENT_PRIVATE_Q]'
          : "['# ]', COMMENT_PRIVATE_Q]"
  const input = `api_keys: ${value}\npublic: repository not found`.replaceAll('\n', newline)
  // Normalize only the parser oracle; raw CR inputs still exercise every privacy assertion below.
  expect(parse(input.replace(/\r\n?/g, '\n')).public).toBe('repository not found')
  for (const output of [redact(input), redact(redact(input)), JSON.stringify(redactData({cause: input}))]) {
    expect(output).not.toContain('COMMENT_PRIVATE_Q')
    expect(output).toContain('repository not found')
  }
  for (const size of [0, 1, 3, 7]) {
    let contexts: string[] = []
    for (let cut = 0; cut <= input.length; cut += size || 1) {
      contexts = size
        ? redactionContext(input.slice(Math.max(0, cut - size), cut), contexts)
        : redactionContext(input.slice(0, cut))
      const output = redact(input.slice(cut), {credentialPrefixes: contexts})
      const surviving = 'COMMENT_PRIVATE_Q'.slice(Math.max(0, cut - input.indexOf('COMMENT_PRIVATE_Q')))
      if (surviving) expect({size, cut, leaked: output.includes(surviving)}).toEqual({size, cut, leaked: false})
      if (cut <= input.indexOf('repository not found')) expect(output).toContain('repository not found')
      expect(contexts.length).toBeLessThan(32)
      expect(contexts.every((context) => context.length < 128 && !context.includes('COMMENT_PRIVATE_Q'))).toBe(true)
    }
  }
})

it.each([1, 2, 3])('AC-15,30 encoded assignments cannot suppress later ordinary credential keys: depth %i', (depth) => {
  const secrets = ['FIRST_PRIVATE_Q', 'SECOND_PRIVATE_Q']
  let encoded = JSON.stringify({token: secrets[0]})
  for (let index = 1; index < depth; index++) encoded = JSON.stringify({error: encoded})
  const input = JSON.stringify({error: encoded, password: secrets[1], public: 'repository not found'})
  for (const size of [0, 1, 3, 7]) {
    let contexts: string[] = []
    for (let cut = 0; cut <= input.length; cut += size || 1) {
      contexts = size
        ? redactionContext(input.slice(Math.max(0, cut - size), cut), contexts)
        : redactionContext(input.slice(0, cut))
      const output = redact(input.slice(cut), {credentialPrefixes: contexts})
      for (const secret of secrets) {
        const surviving = secret.slice(Math.max(0, cut - input.indexOf(secret)))
        if (surviving)
          expect({depth, size, cut, leaked: output.includes(surviving)}).toEqual({depth, size, cut, leaked: false})
      }
      if (cut <= input.indexOf('repository not found')) expect(output).toContain('repository not found')
      expect(contexts.every((context) => context.length < 128)).toBe(true)
    }
  }
})

it.each(
  ['\n', '\r', '\r\n'].flatMap((newline) =>
    ['array', 'object'].flatMap((kind) => [false, true].map((nextLine) => ({newline, kind, nextLine}))),
  ),
)(
  'AC-15,30 multiline credential containers retain delimiters across every cut: $kind $nextLine $newline',
  ({newline, kind, nextLine}) => {
    const secrets = ['CONTAINER_PRIVATE_Q', 'INNER_PRIVATE_Q']
    const values = [secrets[0], {nested: [secrets[1] + ']}"\\', null, 42]}]
    let input = JSON.stringify(
      {api_keys: kind === 'array' ? values : {values}, public: 'repository not found'},
      null,
      2,
    ).replace(/^ +/gm, '')
    if (nextLine) input = input.replace('"api_keys": ', '"api_keys":\n')
    input = input.replaceAll('\n', newline)
    JSON.parse(input)
    for (const output of [redact(input), JSON.stringify(redactData({error: input})), redact(redact(input))]) {
      for (const secret of secrets) expect(output).not.toContain(secret)
      expect(output).toContain('repository not found')
    }
    for (const size of [0, 1, 3, 7]) {
      let contexts: string[] = []
      for (let cut = 0; cut <= input.length; cut += size || 1) {
        contexts = size
          ? redactionContext(input.slice(Math.max(0, cut - size), cut), contexts)
          : redactionContext(input.slice(0, cut))
        const output = redact(input.slice(cut), {credentialPrefixes: contexts})
        for (const secret of secrets) {
          const surviving = secret.slice(Math.max(0, cut - input.indexOf(secret)))
          if (surviving) expect({size, cut, leaked: output.includes(surviving)}).toEqual({size, cut, leaked: false})
        }
        if (cut <= input.indexOf('repository not found')) expect(output).toContain('repository not found')
        expect(contexts.length).toBeLessThan(32)
        expect(
          contexts.every((context) => context.length < 128 && secrets.every((secret) => !context.includes(secret))),
        ).toBe(true)
      }
    }
  },
)
it.each(['access_token,', 'provider,credential,'])(
  'AC-15,30 member-boundary recovery preserves quoted credential names: %s',
  (key) => {
    const input = JSON.stringify({[key]: 'COMMA_PRIVATE_Q', public: 'repository not found'})
    for (let cut = 0; cut <= input.length; cut++) {
      const output = redact(input.slice(cut), {credentialPrefixes: redactionContext(input.slice(0, cut))})
      const surviving = 'COMMA_PRIVATE_Q'.slice(Math.max(0, cut - input.indexOf('COMMA_PRIVATE_Q')))
      if (surviving) expect(output).not.toContain(surviving)
      if (cut <= input.indexOf('repository not found')) expect(output).toContain('repository not found')
    }
  },
)
it('AC-15,30 deep credential containers retain only bounded depth/quote counters', () => {
  const depth = 32768
  const head = '{"password":' + '['.repeat(depth)
  let contexts: string[] = []
  for (let cut = 0; cut < head.length; cut += 512) {
    contexts = redactionContext(head.slice(cut, cut + 512), contexts)
    expect(contexts.length).toBeLessThan(8)
    expect(contexts.every((context) => context.length < 64)).toBe(true)
  }
  const output = redact('"DEEP_PRIVATE_Q"' + ']'.repeat(depth) + ',"public":"repository not found"}', {
    credentialPrefixes: contexts,
  })
  expect(output).not.toContain('DEEP_PRIVATE_Q')
  expect(output).toContain('repository not found')
  expect(redact('{"public":[\n"PUBLIC_DIAGNOSTIC"\n]}')).toContain('PUBLIC_DIAGNOSTIC')
})

it.each([1, 2, 3])('AC-15,30 escaped JSON depth %i protects credentials at every retained-context cut', (depth) => {
  const secret = 'NESTED_PRIVATE_Q'
  let input = JSON.stringify({access_token: secret, public: 'repository not found'})
  for (let index = 0; index < depth; index++) input = JSON.stringify({error: input})
  expect(redact(input)).not.toContain(secret)
  expect(redact(input)).toContain('repository not found')
  for (let cut = 0; cut <= input.length; cut++) {
    const contexts = redactionContext(input.slice(0, cut))
    const output = redact(input.slice(cut), {credentialPrefixes: contexts})
    expect(contexts.every((context) => context.length < 128 && !context.includes(secret))).toBe(true)
    const surviving = secret.slice(Math.max(0, cut - input.indexOf(secret)))
    if (surviving) expect({cut, leaked: output.includes(surviving)}).toEqual({cut, leaked: false})
    if (cut <= input.indexOf('repository not found'))
      expect({cut, output}).toMatchObject({output: expect.stringContaining('repository not found')})
  }
  for (const size of [1, 3, 7]) {
    let contexts: string[] = []
    for (let cut = 0; cut < input.length; cut += size) {
      contexts = redactionContext(input.slice(cut, cut + size), contexts)
      const tail = input.slice(cut + size),
        output = redact(tail, {credentialPrefixes: contexts})
      const surviving = secret.slice(Math.max(0, cut + size - input.indexOf(secret)))
      if (surviving) expect({size, cut, leaked: output.includes(surviving)}).toEqual({size, cut, leaked: false})
      if (cut + size <= input.indexOf('repository not found')) expect(output).toContain('repository not found')
      expect(contexts.every((context) => context.length < 128 && !context.includes(secret))).toBe(true)
    }
  }
})
/** Complete text, every retained-context cut and small chunks must all hide the secret and keep public text. */
function expectPrivateAcrossCuts(input: string, secret: string) {
  const at = input.indexOf(secret),
    publicAt = input.indexOf('repository not found')
  for (const output of [redact(input), JSON.stringify(redactData({cause: input}))]) {
    expect(output).not.toContain(secret)
    expect(output).toContain('repository not found')
  }
  for (let cut = 0; cut <= input.length; cut++) {
    const contexts = redactionContext(input.slice(0, cut))
    const output = redact(input.slice(cut), {credentialPrefixes: contexts})
    expect(contexts.every((context) => context.length < 128 && !context.includes(secret))).toBe(true)
    const surviving = secret.slice(Math.max(0, cut - at))
    if (surviving) expect({cut, leaked: output.includes(surviving)}).toEqual({cut, leaked: false})
    if (cut <= publicAt) expect({cut, output}).toMatchObject({output: expect.stringContaining('repository not found')})
  }
  for (const size of [1, 3, 7]) {
    let contexts: string[] = []
    for (let cut = 0; cut < input.length; cut += size) {
      contexts = redactionContext(input.slice(cut, cut + size), contexts)
      const output = redact(input.slice(cut + size), {credentialPrefixes: contexts})
      const surviving = secret.slice(Math.max(0, cut + size - at))
      if (surviving) expect({size, cut, leaked: output.includes(surviving)}).toEqual({size, cut, leaked: false})
      if (cut + size <= publicAt) expect(output).toContain('repository not found')
      expect(contexts.every((context) => context.length < 128 && !context.includes(secret))).toBe(true)
    }
  }
}
it.each(
  [
    {
      shape: 'tab-indented',
      inner: (secret: string) => JSON.stringify({access_token: secret, public: 'repository not found'}, null, '\t'),
    },
    {
      shape: 'unindented',
      inner: (secret: string) => `{\n"access_token":${JSON.stringify(secret)},\n"public":"repository not found"}`,
    },
    {
      shape: 'plain assignment',
      inner: (secret: string) =>
        JSON.stringify({message: `failed\npassword=${secret} retry`, public: 'repository not found'}),
    },
    {
      shape: 'carriage-return assignment',
      inner: (secret: string) =>
        JSON.stringify({message: `failed\rclient_secret=${secret} retry`, public: 'repository not found'}),
    },
    {
      shape: 'short alias',
      inner: (secret: string) =>
        JSON.stringify({message: `failed\nsig=${secret} retry`, public: 'repository not found'}),
    },
  ].flatMap((payload) => [1, 2].map((depth) => ({...payload, depth}))),
)('AC-15,30 escaped $shape JSON at depth $depth keeps keys after escaped whitespace private', ({inner, depth}) => {
  const secret = 'ESCAPED_WHITESPACE_PRIVATE_Q'
  let input = inner(secret)
  for (let index = 0; index < depth; index++) input = JSON.stringify({error: input})
  expectPrivateAcrossCuts(input, secret)
})
it.each([
  ['\\u000a', 'denied\\u000apassword=SECRET retry'],
  ['\\u000D', 'denied\\u000Dclient_secret=SECRET retry'],
  ['\\u0009', '{\\u0009\\"access_token\\":\\"SECRET\\"}'],
  ['\\f', 'denied\\ftoken=SECRET retry'],
  ['\\b', 'denied\\bapi_key=SECRET retry'],
  ['\\u0026', 'GET /repo?page=1\\u0026token=SECRET retry'],
  ['\\n before %73ig', 'denied\\n%73ig=SECRET retry'],
  ['\\u000a before %73ig', 'denied\\u000a%73ig=SECRET retry'],
])('AC-15,30 escaped separator %s keeps the following credential private', (_, member) => {
  const secret = 'ESCAPED_SEPARATOR_PRIVATE_Q'
  expectPrivateAcrossCuts(`{"error":"${member.replace('SECRET', secret)}","public":"repository not found"}`, secret)
})
it.each(['open C:\\Secrets\\Npm_auth: Access is denied.', 'C:\\Data\\Tokens\\Rsa_key: missing'])(
  'AC-15 uppercase path segments are not JSON whitespace escapes: %s',
  (input) => {
    expect(redact(input)).toBe(input)
  },
)
it('AC-15,30 long encoded escape runs retain syntax counters, not discarded private bytes', () => {
  const slashes = '\\'.repeat(32_768),
    secret = 'ESCAPED_FLOOD_PRIVATE_Q'
  const input = JSON.stringify({error: JSON.stringify({token: slashes + secret, public: 'repository not found'})})
  expect(redact(input)).not.toContain(secret)
  expect(redact(input)).toContain('repository not found')
  let contexts: string[] = []
  const cut = input.indexOf(secret) + 3
  for (let start = 0; start < cut; start += 1024) {
    contexts = redactionContext(input.slice(start, Math.min(start + 1024, cut)), contexts)
    expect(contexts.length).toBeLessThan(32)
    expect(contexts.every((context) => context.length < 128 && !context.includes(secret))).toBe(true)
  }
  const output = redact(input.slice(cut), {credentialPrefixes: contexts})
  expect(output).not.toContain(secret.slice(3))
  expect(output).toContain('repository not found')
  expect(redactionContext('\\"partial' + slashes).every((context) => context.length < 128)).toBe(true)
})
it.each(['\r', '\n', '\r\n'])('AC-15,30 scalar line boundaries preserve public siblings: %j', (newline) => {
  const input = ['root:', '  password: CR_PRIVATE_Q', '  public: repository not found', 'visible=yes'].join(newline)
  expect(redact(input)).not.toContain('CR_PRIVATE_Q')
  expect(redact(input)).toContain('repository not found')
  for (let cut = 0; cut <= input.length; cut++) {
    const output = redact(input.slice(cut), {credentialPrefixes: redactionContext(input.slice(0, cut))})
    if (cut <= input.indexOf('repository not found')) expect(output).toContain('repository not found')
    if (cut <= input.indexOf('CR_PRIVATE_Q')) expect(output).not.toContain('CR_PRIVATE_Q')
  }
})

it.each([
  'password: MULTI_FIRST_Q MULTI_SECOND_Q\n  MULTI_THIRD_Q',
  'password=\n  MULTI_FIRST_Q MULTI_SECOND_Q\n  MULTI_THIRD_Q',
  'password: MULTI_FIRST_Q&MULTI_SECOND_Q\n  MULTI_THIRD_Q',
  'password:\n  MULTI_FIRST_Q MULTI_SECOND_Q\n\n  MULTI_THIRD_Q',
  'password:\r\n\tMULTI_FIRST_Q MULTI_SECOND_Q\r\n\tMULTI_THIRD_Q',
  ...['|', '|-', '|+', '|2', '|2-', '>', '>-', '>+', '>2+'].map(
    (scalar) => `password: ${scalar}\n  MULTI_FIRST_Q MULTI_SECOND_Q\n  MULTI_THIRD_Q`,
  ),
  'root:\n  password: |\n    MULTI_FIRST_Q MULTI_SECOND_Q\n    MULTI_THIRD_Q\n  public=yes',
  'root:\n  - password: >-\n      MULTI_FIRST_Q MULTI_SECOND_Q\n      MULTI_THIRD_Q\n    public=yes',
  'root:\n  "api%5fkey": |\n    MULTI_FIRST_Q MULTI_SECOND_Q\n    MULTI_THIRD_Q\n  public=yes',
  "password: 'MULTI_FIRST_Q''MULTI_SECOND_Q'",
  "password: 'MULTI_FIRST_Q\\''MULTI_SECOND_Q'",
  'password=prefix&MULTI_FIRST_Q&MULTI_SECOND_Q',
  'client_secret=prefix&MULTI_FIRST_Q;MULTI_SECOND_Q',
  'api_keys:\n- MULTI_FIRST_Q\n- MULTI_SECOND_Q',
  'api_keys:\r\n- MULTI_FIRST_Q\r\n-\r\n  MULTI_SECOND_Q',
  'root:\n  api_keys:\n  - MULTI_FIRST_Q\n  - MULTI_SECOND_Q\n  public=yes',
  '- api_keys:\n  - MULTI_FIRST_Q\n  - MULTI_SECOND_Q\n  public=yes',
  '"api_keys":\n- MULTI_FIRST_Q\n- MULTI_SECOND_Q',
  "'api_keys':\n- MULTI_FIRST_Q\n- MULTI_SECOND_Q",
  'root:\n  "api_keys":\n  - MULTI_FIRST_Q\n  - MULTI_SECOND_Q\n  public=yes',
  'password: Bearer MULTI_FIRST_Q\n  MULTI_SECOND_Q',
  'password: Basic MULTI_FIRST_Q:MULTI_SECOND_Q',
  'client_secret: Bearer MULTI_FIRST_Q MULTI_SECOND_Q',
  'client_secret=\n  Basic MULTI_FIRST_Q:MULTI_SECOND_Q',
  'sig : MULTI_FIRST_Q MULTI_SECOND_Q',
  '%73ig : MULTI_FIRST_Q MULTI_SECOND_Q',
])('AC-15,30 complete scalar credentials remain private at every context cut: %j', (value) => {
  const input = `${value}\nvisible=yes\n`
  for (const output of [redact(input), redact(redact(input)), JSON.stringify(redactData({cause: input}))]) {
    for (const secret of ['MULTI_FIRST_Q', 'MULTI_SECOND_Q', 'MULTI_THIRD_Q']) expect(output).not.toContain(secret)
    expect(output).toContain('visible=yes')
    if (input.includes('public=yes')) expect(output).toContain('public=yes')
  }
  for (let cut = 0; cut <= input.length; cut++) {
    const contexts = redactionContext(input.slice(0, cut))
    expect(contexts.every((context) => context.length < 128)).toBe(true)
    const output = redact(input.slice(cut), {credentialPrefixes: contexts})
    for (const secret of ['MULTI_FIRST_Q', 'MULTI_SECOND_Q', 'MULTI_THIRD_Q']) {
      const start = input.indexOf(secret),
        end = start + secret.length
      if (start < 0 || cut >= end) continue
      const surviving = secret.slice(Math.max(0, cut - start))
      expect({cut, surviving, leaked: output.includes(surviving)}).toEqual({cut, surviving, leaked: false})
      expect(contexts.join('')).not.toContain(secret)
    }
    for (const publicText of ['public=yes', 'visible=yes'])
      if (input.includes(publicText) && cut <= input.indexOf(publicText)) expect(output).toContain(publicText)
  }
})
it.each([' '.repeat(16), '\t'.repeat(16), '- '.repeat(8)])(
  'AC-15,16,30 repeated indentation retains one complete origin, not every discarded suffix: %j',
  (chunk) => {
    let contexts: string[] = []
    for (let index = 0; index < 100; index++) {
      contexts = redactionContext(chunk, contexts)
      expect(contexts.length).toBeLessThanOrEqual(2)
      expect(contexts.every((value) => value.length < 128)).toBe(true)
    }
    const indent = chunk.length * 100
    const remainder = `password:\n${' '.repeat(indent + 2)}INDENT_PRIVATE_Q\n${' '.repeat(indent)}public=yes\nvisible=yes`
    const output = redact(remainder, {credentialPrefixes: contexts})
    expect(output).not.toContain('INDENT_PRIVATE_Q')
    expect(output).toContain('public=yes')
    expect(output).toContain('visible=yes')
  },
)
it('AC-15,30 discarded long scalar bodies and indentation use bounded syntax-only state', () => {
  const indentation = ' '.repeat(4096)
  const value = `root:\n${indentation}password: |\n${indentation}  ${'SCALAR_PRIVATE_Q '.repeat(20000)}\n${indentation}public=yes\n`
  for (const cut of [4105, 4118, 8230, 10000, value.indexOf('public=yes') - 2048]) {
    const contexts = redactionContext(value.slice(0, cut))
    expect(contexts.every((context) => context.length < 128 && !context.includes('SCALAR_PRIVATE_Q'))).toBe(true)
    const output = redact(value.slice(cut), {credentialPrefixes: contexts})
    expect(output).not.toContain('SCALAR_PRIVATE_Q')
    expect(output).toContain('public=yes')
  }
})

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
  'password:\n  PRIVATE_CREDENTIAL_Q',
  'password:\r\n\tPRIVATE_CREDENTIAL_Q',
  'password=\n\n  PRIVATE_CREDENTIAL_Q',
  'client_secret:\n  "prefix PRIVATE_CREDENTIAL_Q suffix"',
  'api%5fkey:\r\n  PRIVATE_CREDENTIAL_Q',
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
it.each(['password:', 'password=', 'client_secret:', 'api_keys:'])(
  'AC-15,30 an empty %s never consumes an unindented next public diagnostic',
  (prefix) => {
    for (const separator of ['\n', '\r\n', '\n\n']) {
      const input = `${prefix}${separator}PUBLIC_AFTER_EMPTY\nvisible=yes`
      expect(redact(input)).toBe(input)
      for (let cut = 0; cut <= input.length; cut++)
        expect(redact(input.slice(cut), {credentialPrefixes: redactionContext(input.slice(0, cut))})).toBe(
          input.slice(cut),
        )
    }
  },
)
it('AC-15,30 an indentless sequence ends before a public non-sequence dash word', () => {
  const input = 'api_keys:\n- MULTI_FIRST_Q\n-not-a-sequence\nvisible=yes'
  for (let cut = 0; cut <= input.length; cut++) {
    const output = redact(input.slice(cut), {credentialPrefixes: redactionContext(input.slice(0, cut))})
    if (cut <= input.indexOf('-not-a-sequence')) expect(output).toContain('-not-a-sequence')
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
