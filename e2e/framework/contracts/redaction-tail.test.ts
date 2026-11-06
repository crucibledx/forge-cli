import {join} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {expect, it} from 'bun:test'

import {executeCheck} from '../../../scripts/validation-process'
import {redact} from '../../../src/domain/redact'
import {runPipe} from '../pipe'
import {createTranscript, sanitize, TAIL_BYTES} from '../process'

const dir = useTmpDir('redacted-tail')
function expectPrivateTail(
  transcript: ReturnType<typeof createTranscript>,
  value: string,
  credential: string,
  cut: number,
) {
  const surviving = credential.slice(Math.max(0, cut - value.indexOf(credential)))
  if (surviving) expect({cut, leaked: transcript.diagnostic().includes(surviving)}).toEqual({cut, leaked: false})
  expect({cut, visible: transcript.diagnostic().includes('x'.repeat(64))}).toEqual({cut, visible: true})
  expect(Buffer.byteLength(transcript.diagnostic())).toBeLessThanOrEqual(TAIL_BYTES)
}
it.each(['Bearer ', 'password=', 'https://fixture.invalid?token=', 'https://fixture.invalid?%74oken='])(
  'AC-15,16,30 completed credentials do not hide the next ordinary line: %s',
  (prefix) => {
    const value = prefix + 'COMPLETED_CREDENTIAL\n'
    for (const cut of [value.length - 1, value.length]) {
      const transcript = createTranscript((text) => sanitize(text, dir()))
      transcript.append(Buffer.from(value + 'x'.repeat(TAIL_BYTES + cut - value.length)))
      transcript.finish()
      expectPrivateTail(transcript, value, 'COMPLETED_CREDENTIAL', cut)
      transcript.append(Buffer.from('after'))
      expectPrivateTail(transcript, value, 'COMPLETED_CREDENTIAL', cut)
      expect(transcript.diagnostic().endsWith('after')).toBe(true)
    }
  },
)
it.each(['redact', 'sanitize'])(
  'AC-15,16,30 percent-encoded query names remain private across every raw cut: %s',
  async (kind) => {
    const clean = kind === 'redact' ? redact : (text: string) => sanitize(text, dir())
    const credential = 'ENCODED_QUERY_SENTINEL'
    for (const key of ['access_token', 'token', 'password', 'secret', 'key', 'auth']) {
      for (const spelling of [key, key.toUpperCase()]) {
        const encoded = [...spelling].map((char) => '%' + char.charCodeAt(0).toString(16)).join('')
        const value = `https://fixture.invalid?${encoded}=${credential}\n`
        for (let cut = 1; cut < value.length; cut++) {
          const transcript = createTranscript(clean)
          transcript.append(Buffer.from(value + 'x'.repeat(TAIL_BYTES + cut - value.length)))
          expectPrivateTail(transcript, value, credential, cut)
          transcript.finish()
          expectPrivateTail(transcript, value, credential, cut)
          transcript.append(Buffer.from('after'))
          expectPrivateTail(transcript, value, credential, cut)
          expect(transcript.diagnostic().endsWith('after')).toBe(true)
        }
      }
    }
    const value = 'https://fixture.invalid?%74oken=' + credential + '&visible=yes\n'
    const cut = 'https://fixture.invalid?%7'.length
    const program = `const value = ${JSON.stringify(value)} + 'x'.repeat(${TAIL_BYTES + cut - value.length}); await Bun.write(Bun.stdout, value); await Bun.write(Bun.stderr, value)`
    const result =
      kind === 'redact'
        ? await executeCheck([process.execPath, '-e', program], dir(), 10000)
        : await runPipe(dir(), [process.execPath, '-e', program])
    expect(result).toMatchObject(kind === 'redact' ? {exit_code: 0, timed_out: false} : {exitCode: 0, timedOut: false})
    for (const output of [result.stdout, result.stderr]) {
      expect(output.includes(credential)).toBe(false)
      expect(output.includes('&visible=yes')).toBe(true)
    }
  },
)
it.each(['redact', 'sanitize'])(
  'AC-15,16,30 URI scheme continuation survives concurrent Bearer context at every raw cut: %s',
  async (kind) => {
    const clean = kind === 'redact' ? redact : (text: string) => sanitize(text, dir())
    const prefix = 'Bearer custom123'
    const credential = 'VISIBLE_SECRET'
    const value = prefix + `456://user:${credential}@fixture.invalid\n`
    for (let cut = 1; cut < value.length; cut++) {
      const transcript = createTranscript(clean)
      const assertHidden = () => expectPrivateTail(transcript, value, credential, cut)
      transcript.append(Buffer.from(value + 'x'.repeat(TAIL_BYTES + cut - value.length)))
      assertHidden()
      transcript.finish()
      assertHidden()
      transcript.append(Buffer.from('after'))
      assertHidden()
      expect(transcript.diagnostic().endsWith('after')).toBe(true)
    }
    const program = `const value = ${JSON.stringify(value)} + 'x'.repeat(${TAIL_BYTES + prefix.length - value.length}); await Bun.write(Bun.stdout, value); await Bun.write(Bun.stderr, value)`
    const command = [process.execPath, '-e', program]
    const result = kind === 'redact' ? await executeCheck(command, dir(), 10000) : await runPipe(dir(), command)
    expect(result).toMatchObject(kind === 'redact' ? {exit_code: 0, timed_out: false} : {exitCode: 0, timedOut: false})
    for (const output of [result.stdout, result.stderr]) {
      expect(output.includes(credential)).toBe(false)
      expect(output.endsWith('x'.repeat(64))).toBe(true)
    }
  },
)
it.each(['redact', 'sanitize'])(
  'AC-15,16,30 userinfo context survives embedded assignment/query delimiters: %s',
  async (kind) => {
    const prefix = 'https://user:password=prefix'
    const value = prefix + '&ACTUAL_CREDENTIAL@fixture.invalid\n'
    const clean = kind === 'redact' ? redact : (text: string) => sanitize(text, dir())
    const transcript = createTranscript(clean)
    transcript.append(Buffer.from(value + 'x'.repeat(TAIL_BYTES + prefix.length - value.length)))
    transcript.finish()
    transcript.append(Buffer.from('after'))
    expect(transcript.diagnostic().includes('ACTUAL_CREDENTIAL')).toBe(false)
    const program = `await Bun.write(Bun.stdout, ${JSON.stringify(value)} + 'x'.repeat(${TAIL_BYTES + prefix.length - value.length}))`
    const command = [process.execPath, '-e', program]
    const result = kind === 'redact' ? await executeCheck(command, dir(), 10000) : await runPipe(dir(), command)
    expect(result.stdout.includes('ACTUAL_CREDENTIAL')).toBe(false)
  },
)
it.each([
  ['Bearer prefixKNOWNSECRET_ACTUAL_CREDENTIAL_SUFFIX', 'KNOWNSECRET'],
  ['https://fixture.invalid?token=ACTUAL_CREDENTIAL_SUFFIX', 'token'],
  ['https://user:KNOWNSECRET_ACTUAL_CREDENTIAL_SUFFIX@fixture.invalid', 'KNOWNSECRET'],
  ['password=prefixKNOWNSECRET_ACTUAL_CREDENTIAL_SUFFIX', 'KNOWNSECRET'],
])('AC-15,30 independent masking cannot break credential syntax or spans: %s', (value, secret) => {
  expect(sanitize(value, dir(), [secret])).not.toContain('ACTUAL_CREDENTIAL_SUFFIX')
  for (let cut = 1; cut < value.length; cut++) {
    const transcript = createTranscript((text) => sanitize(text, dir(), [secret]), [secret])
    const credential = 'ACTUAL_CREDENTIAL_SUFFIX'
    const assertHidden = () => expectPrivateTail(transcript, value, credential, cut)
    const payload = value + '\n'
    transcript.append(Buffer.from(payload + 'x'.repeat(TAIL_BYTES + cut - payload.length)))
    assertHidden()
    transcript.finish()
    assertHidden()
    transcript.append(Buffer.from('after'))
    assertHidden()
    expect(transcript.diagnostic().endsWith('after')).toBe(true)
  }
})
it.each(['https://fixture.invalid?token=', 'https://user:', 'Bearer '])(
  'AC-15,16,30 real pipe preserves credential context with overlapping fixture secrets: %s',
  async (prefix) => {
    const value = prefix + 'beginsACTUAL_CREDENTIAL' + (prefix === 'https://user:' ? '@fixture.invalid' : '') + '\n'
    const cut = prefix.length + 'begins'.length
    const program = `await Bun.write(Bun.stdout, ${JSON.stringify(value)} + 'x'.repeat(${TAIL_BYTES + cut - value.length}))`
    const result = await runPipe(dir(), [process.execPath, '-e', program], {secrets: ['something']})
    expect(result.exitCode).toBe(0)
    expect(result.stdout).not.toContain('ACTUAL_CREDENTIAL')
    expect(Buffer.byteLength(result.stdout)).toBeLessThanOrEqual(TAIL_BYTES)
  },
)
it.each(['query', 'userinfo', 'bearer', 'assignment'])(
  'AC-15,16,30 explicit-secret prefixes cannot replace concurrent %s credential context',
  (kind) => {
    const secrets = ['something']
    const prefix =
      kind === 'query'
        ? 'https://fixture.invalid?token='
        : kind === 'userinfo'
          ? 'https://user:'
          : kind === 'bearer'
            ? 'Bearer '
            : 'password='
    const value = prefix + 'beginsACTUAL_CREDENTIAL' + (kind === 'userinfo' ? '@fixture.invalid' : '') + '\n'
    const cut = prefix.length + 'begins'.length
    const transcript = createTranscript((text) => sanitize(text, dir(), secrets), secrets)
    transcript.append(Buffer.from(value + 'x'.repeat(TAIL_BYTES + cut - value.length)))
    expect(transcript.diagnostic()).not.toContain('ACTUAL_CREDENTIAL')
    transcript.finish()
    expect(transcript.diagnostic()).not.toContain('ACTUAL_CREDENTIAL')
    transcript.append(Buffer.from('after'))
    expect(transcript.diagnostic()).not.toContain('ACTUAL_CREDENTIAL')
  },
)
it.each([
  ['something', 'beginsMORE'],
  ['beginsMORE', 'something'],
])('AC-15,30 overlapping explicit secret prefixes retain the longest suffix independently: %j', (first, second) => {
  const secrets = [first, second]
  const value = 'beginsMORE\n',
    cut = 'begins'.length
  const transcript = createTranscript((text) => sanitize(text, dir(), secrets), secrets)
  transcript.append(Buffer.from(value + 'x'.repeat(TAIL_BYTES + cut - value.length)))
  transcript.finish()
  expect(transcript.diagnostic()).not.toContain('MORE')
})
it('AC-15,30 arbitrary explicit-secret continuations stay hidden alongside Bearer syntax', () => {
  const secrets = ['s!EXPLICIT_SUFFIX'],
    prefix = 'Bearer begins'
  const value = prefix + '!EXPLICIT_SUFFIX\n'
  const transcript = createTranscript((text) => sanitize(text, dir(), secrets), secrets)
  transcript.append(Buffer.from(value + 'x'.repeat(TAIL_BYTES + prefix.length - value.length)))
  expect(transcript.diagnostic()).not.toContain('EXPLICIT_SUFFIX')
  transcript.finish()
  expect(transcript.diagnostic()).not.toContain('EXPLICIT_SUFFIX')
})
it.each(['redact', 'sanitize'])(
  'AC-15,16,30 apostrophes cannot split a query credential during a raw-tail cut: %s',
  async (kind) => {
    const clean = kind === 'redact' ? redact : (text: string) => sanitize(text, dir())
    const value = "https://fixture.invalid?token=prefix'QUERY_APOSTROPHE_SUFFIX\n"
    for (const cut of ['https://fixture.invalid?token=pre'.length, "https://fixture.invalid?token=prefix'".length]) {
      const transcript = createTranscript(clean)
      transcript.append(Buffer.from(value + 'x'.repeat(TAIL_BYTES + cut - value.length)))
      transcript.finish()
      transcript.append(Buffer.from('after'))
      expect(transcript.diagnostic()).not.toContain('QUERY_APOSTROPHE_SUFFIX')
    }
    const result = await runPipe(dir(), [process.execPath, '-e', `console.error(${JSON.stringify(value)});`])
    expect(result.stderr).not.toContain('QUERY_APOSTROPHE_SUFFIX')
  },
)
it('AC-15,16,18,30 adversarial marker repetition cannot stall the session deadline', async () => {
  const entry = join(import.meta.dir, '../../../src/domain/redact.ts')
  const result = await runPipe(dir(), [
    process.execPath,
    '-e',
    `import {redactionContext} from ${JSON.stringify(entry)}; for (const marker of ['?token=', 'password=']) redactionContext(marker.repeat(40000) + ' '); console.log('completed');`,
  ])
  expect(result.timedOut).toBe(false)
  expect(result.exitCode).toBe(0)
  expect(result.stdout).toContain('completed')
})
it.each(['redact', 'sanitize'])('AC-15,16,30 preserves every query-name cut through finalization: %s', (kind) => {
  const clean = kind === 'redact' ? redact : (text: string) => sanitize(text, dir())
  const secret = 'QUERY_BOUNDARY_FIXTURE_SECRET'
  for (const key of ['access_token', 'token', 'password', 'secret', 'key', 'auth']) {
    for (const separator of ['?', '&', '#']) {
      const prefix = `https://fixture.invalid${separator}`
      const value = `${prefix}${key.toUpperCase()}=${secret}\n`
      for (let size = 0; size <= key.length; size++) {
        const cut = prefix.length + size
        const transcript = createTranscript(clean)
        transcript.append(Buffer.from(value + 'x'.repeat(TAIL_BYTES + cut - value.length)))
        expect(transcript.diagnostic().includes(secret)).toBe(false)
        transcript.finish()
        expect(transcript.diagnostic().includes(secret)).toBe(false)
        transcript.append(Buffer.from('after'))
        expect(transcript.diagnostic().includes(secret)).toBe(false)
        expect(Buffer.byteLength(transcript.diagnostic())).toBeLessThanOrEqual(TAIL_BYTES)
      }
    }
  }
})
it.each([
  'https://user:fixture-password@fixture.invalid',
  'Bearer fixture-password',
  'https://fixture.invalid?token=fixture-password',
])('AC-15,16,30 retains redaction context when truncation cuts a credential: %s', (value) => {
  const transcript = createTranscript(redact)
  transcript.append(Buffer.from(value + '\n' + 'x'.repeat(TAIL_BYTES - 13)))
  transcript.append(Buffer.from('after'))
  expect(transcript.diagnostic()).not.toContain('fixture-password')
  expect(Buffer.byteLength(transcript.diagnostic())).toBeLessThanOrEqual(TAIL_BYTES)
})
it.each(['Bearer ', 'https://user:', 'https://fixture.invalid?token=', 'password='])(
  'AC-15,16,30 never unmasks a credential continued across several truncated chunks: %s',
  (prefix) => {
    const transcript = createTranscript((text) => sanitize(text, dir()))
    transcript.append(Buffer.from(prefix + 'S'.repeat(TAIL_BYTES + 20)))
    transcript.append(Buffer.from('CONTINUED_SECRET'))
    transcript.append(Buffer.from(prefix === 'https://user:' ? '@fixture.invalid MORE' : ' MORE'))
    expect(transcript.diagnostic().includes('CONTINUED_SECRET')).toBe(false)
    expect(transcript.diagnostic()).toEndWith(' MORE')
  },
)
it('AC-15,30 preserves explicit fixture-secret recognition across the raw cut', () => {
  const secret = 'fixture-explicit-secret'
  const transcript = createTranscript((text) => sanitize(text, dir(), [secret]), [secret])
  transcript.append(Buffer.from(secret + '\n' + 'x'.repeat(TAIL_BYTES - 10)))
  transcript.append(Buffer.from('after'))
  expect(transcript.diagnostic()).not.toContain(secret.slice(10))
})
it.each(['userinfo', 'query'])('AC-15,30 real pipe and validation artifacts sanitize the %s cut', async (kind) => {
  const value =
    kind === 'userinfo'
      ? 'https://user:fixture-password@fixture.invalid\n'
      : 'https://fixture.invalid?token=fixture-password\n'
  const cut = kind === 'userinfo' ? 13 : 'https://fixture.invalid?to'.length
  const command = [
    process.execPath,
    '-e',
    `process.stdout.write(${JSON.stringify(value)});process.stdout.write("x".repeat(${TAIL_BYTES + cut - value.length}));`,
  ]
  const pipe = await runPipe(dir(), command)
  const check = await executeCheck(command, dir(), 10000)
  expect(pipe.exitCode).toBe(0)
  expect(check.exit_code).toBe(0)
  expect(pipe.stdout.includes('fixture-password')).toBe(false)
  expect(check.stdout.includes('fixture-password')).toBe(false)
})
