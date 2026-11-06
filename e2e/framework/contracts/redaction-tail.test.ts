import {useTmpDir} from '@test-helpers/tmp'
import {expect, it} from 'bun:test'

import {executeCheck} from '../../../scripts/validation-process'
import {redact} from '../../../src/domain/redact'
import {runPipe} from '../pipe'
import {createTranscript, sanitize, TAIL_BYTES} from '../process'

const dir = useTmpDir('redacted-tail')
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
it('AC-15,30 real pipe and validation artifacts use pre-truncation sanitization', async () => {
  const command = [
    process.execPath,
    '-e',
    `console.log("https://user:fixture-password@fixture.invalid");process.stdout.write("x".repeat(${TAIL_BYTES - 13}));`,
  ]
  const pipe = await runPipe(dir(), command)
  const check = await executeCheck(command, dir(), 10000)
  expect(pipe.exitCode).toBe(0)
  expect(check.exit_code).toBe(0)
  expect(pipe.stdout).not.toContain('fixture-password')
  expect(check.stdout).not.toContain('fixture-password')
})
