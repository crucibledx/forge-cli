import {join} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {expect, it} from 'bun:test'

import {executeCheck} from '../../../scripts/validation-process'
import {redact} from '../../../src/domain/redact'
import {runPipe} from '../pipe'
import {createTranscript, sanitize, TAIL_BYTES} from '../process'

const dir = useTmpDir('redacted-tail')
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
