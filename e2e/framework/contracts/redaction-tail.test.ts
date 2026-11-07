import {join} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {expect, it} from 'bun:test'
import stripAnsi from 'strip-ansi'

import {executeCheck} from '../../../scripts/validation-process'
import {redact} from '../../../src/domain/redact'
import {runPipe} from '../pipe'
import {createTranscript, sanitize, TAIL_BYTES} from '../process'
import {driveSession} from '../run'
import {spawnPty} from '../spawn'

const dir = useTmpDir('redacted-tail')
const liveSecret = 'Qv7_PRIVATE_λ_SECRET'
it.each(['redact', 'sanitize'])(
  'AC-15,16,30 double-quoted query credentials remain private across chunk and retained-tail cuts: %s',
  async (kind) => {
    const clean = kind === 'redact' ? redact : (text: string) => sanitize(text, dir())
    const credential = 'DOUBLE_QUOTE_TAIL_SUFFIX'
    for (const key of ['token', '%74oken']) {
      const value = `https://fixture.invalid?${key}=prefix"${credential}&visible=yes\n`
      for (let cut = 1; cut < value.indexOf('&visible'); cut++) {
        const transcript = createTranscript(clean)
        transcript.append(Buffer.from(value + 'x'.repeat(TAIL_BYTES + cut - value.length)))
        expectPrivateTail(transcript, value, credential, cut)
        transcript.finish()
        expectPrivateTail(transcript, value, credential, cut)
        expect(transcript.diagnostic()).toContain('&visible=yes')
        transcript.append(Buffer.from('after'))
        expectPrivateTail(transcript, value, credential, cut)
        expect(transcript.diagnostic()).toEndWith('after')
      }
      for (let cut = 0; cut <= value.length; cut++) {
        const transcript = createTranscript(clean)
        transcript.append(Buffer.from(value.slice(0, cut)))
        transcript.append(Buffer.from(value.slice(cut)))
        transcript.finish()
        expect(transcript.diagnostic()).not.toContain(credential)
        expect(transcript.diagnostic()).toContain('&visible=yes')
      }
      const cut = value.indexOf('"') + 1
      const program = `const value=${JSON.stringify(value)}+'x'.repeat(${TAIL_BYTES + cut - value.length});await Bun.write(Bun.stdout,value);await Bun.write(Bun.stderr,value)`
      const result =
        kind === 'redact'
          ? await executeCheck([process.execPath, '-e', program], 10000)
          : await runPipe(dir(), [process.execPath, '-e', program])
      expect(result).toMatchObject(
        kind === 'redact' ? {exit_code: 0, timed_out: false} : {exitCode: 0, timedOut: false},
      )
      for (const output of [result.stdout, result.stderr]) {
        expect(output).not.toContain(credential)
        expect(output).toContain('&visible=yes')
      }
    }
  },
)
it.each([
  {bytes: 600000, budget: 1000},
  {bytes: 1200000, budget: 7000},
])(
  'AC-15,18,30 repetitive known-secret continuation stays inside independent $budget ms watchdog',
  async ({bytes, budget}) => {
    const program = `import {createTranscript} from ${JSON.stringify(join(import.meta.dir, '../process.ts'))};const t=createTranscript(x=>x,['a'.repeat(${bytes})+'Z']);t.append(Buffer.from('a'.repeat(${bytes})));t.append(Buffer.from('b'));if(!t.visibleDiagnostic().endsWith('b'))throw Error('ordinary suffix lost');console.log('continuation-completed')`
    const result = await executeCheck([process.execPath, '-e', program], budget)
    expect(result.timed_out).toBe(false)
    expect(result.exit_code).toBe(0)
    expect(result.stdout).toContain('continuation-completed')
  },
)
it.each([
  `https://${liveSecret}`,
  `ht\x1b[31mtps://${liveSecret}\x1b[0m`,
  `\x1b]8;;https://fixture.invalid/docs\x1b\\https://${liveSecret}\x1b]8;;\x1b\\`,
  `https://user:${liveSecret}`,
  `https://us\x1b[31mer:${liveSecret}\x1b[0m`,
  `ht\x1b[31mtps://user:${liveSecret}\x1b[0m`,
  `https://user:Qv7_\x9b31mPRIVATE_λ_SECRET\x9b0m`,
  `\x1b]8;;https://fixture.invalid/docs\x1b\\https://user:${liveSecret}\x1b]8;;\x1b\\`,
])('AC-15,16,27,30 unfinished userinfo stays private in every live byte-prefix: %s', (value) => {
  const bytes = Buffer.from(value)
  const assertLive = (transcript: ReturnType<typeof createTranscript>) => {
    const privatePrefix = Array.from({length: liveSecret.length}, (_, index) =>
      liveSecret.slice(0, liveSecret.length - index),
    ).find((prefix) => transcript.text().includes(prefix))
    for (const output of [stripAnsi(transcript.diagnostic()), transcript.visibleDiagnostic()]) {
      if (privatePrefix) expect(output).not.toContain(privatePrefix)
      expect(output).toContain('visible-before')
      expect(Buffer.byteLength(output)).toBeLessThanOrEqual(TAIL_BYTES)
    }
  }
  for (let cut = 0; cut <= bytes.length; cut++) {
    const transcript = createTranscript()
    transcript.append(Buffer.concat([Buffer.from('visible-before\n'), bytes.subarray(0, cut)]))
    assertLive(transcript)
    transcript.append(bytes.subarray(cut))
    assertLive(transcript)
    transcript.append(Buffer.from('@fixture.invalid\nordinary-after'))
    transcript.finish()
    assertLive(transcript)
    expect(transcript.visibleDiagnostic()).toContain('ordinary-after')
    const stopped = createTranscript()
    stopped.append(Buffer.concat([Buffer.from('visible-before\n'), bytes.subarray(0, cut)]))
    stopped.finish()
    assertLive(stopped)
  }
})
it.each(['https://user:', 'https://'])(
  'AC-15,16,27,30 unfinished %s retains syntax after every secret-only eviction',
  (prefix) => {
    const transcript = createTranscript()
    transcript.append(Buffer.from(prefix + 'Z'.repeat(TAIL_BYTES + 32)))
    for (let round = 0; round < 3; round++) {
      transcript.append(Buffer.from('Z'.repeat(TAIL_BYTES + 16)))
      transcript.finish()
      expect(transcript.text()).toContain('Z')
      for (const output of [transcript.diagnostic(), transcript.visibleDiagnostic()]) expect(output).not.toContain('Z')
    }
    transcript.append(Buffer.from('Z@fixture.invalid\nordinary-after'))
    expect(transcript.visibleDiagnostic()).not.toContain('Z')
    expect(transcript.visibleDiagnostic()).toContain('ordinary-after')
  },
)
it.each(['https://fixture.invalid/docs', 'https://fixture.invalid:8080/docs', 'http://[::1]:8080/docs'])(
  'AC-15,16,30 complete non-credential URLs retain ordinary text: %s',
  (value) => {
    const bytes = Buffer.from(value)
    for (let cut = 0; cut <= bytes.length; cut++) {
      const transcript = createTranscript()
      transcript.append(bytes.subarray(0, cut))
      transcript.append(bytes.subarray(cut))
      transcript.finish()
      expect(transcript.visibleDiagnostic()).toBe(value)
      expect(stripAnsi(transcript.diagnostic())).toBe(value)
    }
  },
)
it.each(['pipe', 'pty', 'validation', 'token-pipe', 'token-pty', 'token-validation'] as const)(
  'AC-15,16,27,30 actual %s failure before userinfo completion remains private',
  async (kind) => {
    const mode = kind.replace('token-', '')
    if (mode === 'pty' && process.platform === 'win32') return
    const value = 'visible-before\n' + (kind.startsWith('token-') ? 'https://' : 'https://user:') + liveSecret
    const command = [
      process.execPath,
      '-e',
      `process.stdout.write(${JSON.stringify(value)});process.stderr.write(${JSON.stringify(value)});setInterval(()=>{},1000)`,
    ]
    let views: string[]
    if (mode === 'pty') {
      const cli = spawnPty(dir(), command)
      let failure: Error | undefined
      try {
        await driveSession(cli, async (session) => {
          await session.waitForText(liveSecret)
          expect(session.getOutput()).not.toContain(liveSecret)
          throw new Error('driver assertion')
        })
      } catch (error) {
        failure = error as Error
      }
      expect(failure?.message).toContain('driver assertion')
      views = [failure!.message, failure!.stack!]
    } else {
      const result =
        mode === 'pipe' ? await runPipe(dir(), command, {timeoutMs: 500}) : await executeCheck(command, 500)
      expect(
        mode === 'pipe'
          ? (result as Awaited<ReturnType<typeof runPipe>>).timedOut
          : (result as Awaited<ReturnType<typeof executeCheck>>).timed_out,
      ).toBe(true)
      views = [result.stdout, result.stderr]
    }
    for (const output of views) {
      expect(output).not.toContain(liveSecret)
      expect(output).toContain('visible-before')
    }
  },
)
it.each(['diagnostic', 'context'])(
  'AC-15,18,30 colon-heavy %s remains bounded under independent watchdog',
  async (operation) => {
    const program = `import {createTranscript} from ${JSON.stringify(join(import.meta.dir, '../process.ts'))};import {redactionContext} from ${JSON.stringify(join(import.meta.dir, '../../../src/domain/redact.ts'))};const value='https://'+':'.repeat(262144)+'/';${operation === 'context' ? 'redactionContext(value)' : 'createTranscript().append(Buffer.from(value))'};console.log('completed');`
    const result = await executeCheck([process.execPath, '-e', program], 5000)
    expect(result.timed_out).toBe(false)
    expect(result.exit_code).toBe(0)
    expect(result.stdout).toContain('completed')
  },
)
it.each([
  ['FI\u001b[31mXTURE_SECRET\u001b[0m', ['FIXTURE_SECRET']],
  ['Bearer \u001b[31mFIXTURE_SECRET\u001b[0m', []],
  ['Be\u001b[31marer FIXTURE_SECRET\u001b[0m', []],
  ['https://user:\u001b[31mFIXTURE_SECRET\u001b[0m@fixture.invalid', []],
  ['https://fixture.invalid?%74oken=\u001b[31mFIXTURE_SECRET\u001b[0m', []],
  ['FI\u001b]0;format\u0007XTURE_SECRET', ['FIXTURE_SECRET']],
  ['\u001b]8;;https://fixture.invalid/?token=FIXTURE_SECRET\u001b\\FIXTURE_SECRET\u001b]8;;\u001b\\', []],
  ['\u001b]8;;https://fixture.invalid/?token=FIXTURE_SECRET\u0007FIXTURE_SECRET\u001b]8;;\u0007', []],
  ['\u009d8;;https://fixture.invalid/?token=FIXTURE_SECRET\u009cFIXTURE_SECRET\u009d8;;\u009c', []],
] as const)('AC-15,16,30 formatted credentials stay private at every chunk boundary: %s', (value, known) => {
  const secrets = [...known]
  const bytes = Buffer.from(value)
  for (let cut = 0; cut <= bytes.length; cut++) {
    const transcript = createTranscript((text) => sanitize(text, dir(), secrets), secrets)
    transcript.append(Buffer.concat([Buffer.from('visible-before\n'), bytes.subarray(0, cut)]))
    transcript.append(Buffer.concat([bytes.subarray(cut), Buffer.from('\nvisible-after')]))
    transcript.finish()
    for (const output of [stripAnsi(transcript.diagnostic()), transcript.visibleDiagnostic()]) {
      expect(output).not.toContain('FIXTURE_SECRET')
      expect(output).toContain('visible-before')
      expect(output).toContain('visible-after')
    }
    const bounded = createTranscript((text) => sanitize(text, dir(), secrets), secrets)
    bounded.append(Buffer.from(value + '\n' + 'x'.repeat(TAIL_BYTES + cut - bytes.length - 1)))
    const assertBounded = () => {
      const surviving = Array.from({length: 'FIXTURE_SECRET'.length}, (_, i) => 'FIXTURE_SECRET'.slice(i)).find(
        (suffix) => bounded.text().includes(suffix),
      )
      for (const diagnostic of [stripAnsi(bounded.diagnostic()), bounded.visibleDiagnostic()]) {
        if (surviving)
          expect({cut, surviving, leaked: diagnostic.includes(surviving)}).toEqual({cut, surviving, leaked: false})
        expect(diagnostic).toContain('x'.repeat(64))
        expect(Buffer.byteLength(diagnostic)).toBeLessThanOrEqual(TAIL_BYTES)
      }
    }
    assertBounded()
    bounded.finish()
    assertBounded()
    bounded.append(Buffer.from('after'))
    assertBounded()
    expect(bounded.visibleDiagnostic()).toEndWith('after')
  }
})
it('AC-15,16,30 raw-only privacy survives multiple invisible evictions and finalization', () => {
  const transcript = createTranscript()
  transcript.append(
    Buffer.from('\u001b]8;;https://fixture.invalid/?token=FIXTURE_SECRET\u001b\\FIXTURE_SECRET\u001b]8;;\u001b\\\n'),
  )
  for (let i = 0; i < 3; i++) {
    transcript.append(Buffer.from('\u001b]0;' + 'x'.repeat(TAIL_BYTES + 64) + '\u0007'))
    transcript.finish()
    transcript.append(Buffer.from('visible-after\n'))
    expect(transcript.text()).toContain('FIXTURE_SECRET')
    for (const diagnostic of [stripAnsi(transcript.diagnostic()), transcript.visibleDiagnostic()]) {
      expect(diagnostic).not.toContain('FIXTURE_SECRET')
      expect(Buffer.byteLength(diagnostic)).toBeLessThanOrEqual(TAIL_BYTES)
    }
    expect(transcript.visibleDiagnostic()).toContain('visible-after')
  }
})
it.each(['https://fixture.invalid/docs', 'https://fixture.invalid/?token=NONLABEL_SECRET&visible=yes'])(
  'AC-15,16,30 non-sensitive hyperlink labels remain visible: %s',
  (url) => {
    const transcript = createTranscript()
    transcript.append(Buffer.from(`\u001b]8;;${url}\u001b\\ordinary-label\u001b]8;;\u001b\\`))
    transcript.finish()
    expect(transcript.text()).toBe('ordinary-label')
    expect(transcript.visibleDiagnostic()).toBe('ordinary-label')
    expect(transcript.diagnostic()).toContain('\u001b]8;;')
    expect(transcript.diagnostic()).not.toContain('NONLABEL_SECRET')
  },
)
it.each(['pipe', 'pty', 'validation'] as const)('AC-15,16,30 actual %s OSC8 labels remain private', async (kind) => {
  if (kind === 'pty' && process.platform === 'win32') return
  const value =
    'visible-before\n\u001b]8;;https://fixture.invalid/?token=FIXTURE_SECRET\u001b\\FIXTURE_SECRET\u001b]8;;\u001b\\\nvisible-after'
  const command = [
    process.execPath,
    '-e',
    `await Bun.write(Bun.stdout, ${JSON.stringify(value)}); await Bun.write(Bun.stderr, ${JSON.stringify(value)})`,
  ]
  const outputs: string[] = []
  if (kind === 'validation') {
    const result = await executeCheck(command, 10000)
    expect(result).toMatchObject({exit_code: 0, timed_out: false})
    outputs.push(result.stdout, result.stderr)
  } else {
    const result = kind === 'pipe' ? await runPipe(dir(), command) : await spawnPty(dir(), command).waitForExit()
    expect(result).toMatchObject({exitCode: 0, timedOut: false})
    outputs.push(result.output)
    if (kind === 'pipe') outputs.push(result.stdout, result.stderr)
    else {
      expect(result.stdout).toBe('')
      expect(result.stderr).toBe('')
    }
  }
  for (const output of outputs) {
    expect(stripAnsi(output)).not.toContain('FIXTURE_SECRET')
    expect(stripAnsi(output)).toContain('visible-before')
    expect(stripAnsi(output)).toContain('visible-after')
  }
})
it.each(['pipe', 'pty'] as const)(
  'AC-15,16,30 actual %s formatted output hides known and automatic credentials',
  async (kind) => {
    if (kind === 'pty' && process.platform === 'win32') return
    const value =
      'visible-before\nFI\u001b[31mXTURE_SECRET\u001b[0m\nBearer \u001b[31mAUTO_CREDENTIAL\u001b[0m\nvisible-after'
    const command = [
      process.execPath,
      '-e',
      `await Bun.write(Bun.stdout, ${JSON.stringify(value)}); await Bun.write(Bun.stderr, ${JSON.stringify(value)})`,
    ]
    const result =
      kind === 'pipe'
        ? await runPipe(dir(), command, {secrets: ['FIXTURE_SECRET']})
        : await spawnPty(dir(), command, {secrets: ['FIXTURE_SECRET']}).waitForExit()
    expect(result).toMatchObject({exitCode: 0, timedOut: false})
    for (const output of [result.output, result.stdout, result.stderr]) {
      expect(stripAnsi(output)).not.toContain('FIXTURE_SECRET')
      expect(stripAnsi(output)).not.toContain('AUTO_CREDENTIAL')
    }
    expect(result.output).toContain('visible-before')
    expect(result.output).toContain('visible-after')
  },
)
it('AC-15,16,30 validation diagnostics also hide ANSI-formatted automatic credentials on both streams', async () => {
  const value = 'visible-before\nBearer \u001b[31mVALIDATION_CREDENTIAL\u001b[0m\nvisible-after'
  const result = await executeCheck(
    [
      process.execPath,
      '-e',
      `await Bun.write(Bun.stdout, ${JSON.stringify(value)});await Bun.write(Bun.stderr, ${JSON.stringify(value)})`,
    ],
    10000,
  )
  expect(result).toMatchObject({exit_code: 0, timed_out: false})
  for (const output of [result.stdout, result.stderr]) {
    expect(output).not.toContain('VALIDATION_CREDENTIAL')
    expect(output).toContain('visible-before')
    expect(output).toContain('visible-after')
  }
})
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
// Each complete spelling/view keeps its own unchanged runner budget.
it.each(
  ['access_token', 'token', 'password', 'secret', 'key', 'auth'].flatMap((key) =>
    [key, key.toUpperCase()].flatMap((spelling) => ['redact', 'sanitize'].map((kind) => ({spelling, kind}))),
  ),
)('AC-15,16,30 percent-encoded query names remain private across every raw cut: %j', ({kind, spelling}) => {
  const clean = kind === 'redact' ? redact : (text: string) => sanitize(text, dir())
  const credential = 'ENCODED_QUERY_SENTINEL'
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
})
it.each(['redact', 'sanitize'])(
  'AC-15,16,30 actual streams preserve percent-encoded query masking and visible parameters: %s',
  async (kind) => {
    const credential = 'ENCODED_QUERY_SENTINEL'
    const value = 'https://fixture.invalid?%74oken=' + credential + '&visible=yes\n'
    const cut = 'https://fixture.invalid?%7'.length
    const program = `const value = ${JSON.stringify(value)} + 'x'.repeat(${TAIL_BYTES + cut - value.length}); await Bun.write(Bun.stdout, value); await Bun.write(Bun.stderr, value)`
    const result =
      kind === 'redact'
        ? await executeCheck([process.execPath, '-e', program], 10000)
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
    const result = kind === 'redact' ? await executeCheck(command, 10000) : await runPipe(dir(), command)
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
    const result = kind === 'redact' ? await executeCheck(command, 10000) : await runPipe(dir(), command)
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
  const check = await executeCheck(command, 10000)
  expect(pipe.exitCode).toBe(0)
  expect(check.exit_code).toBe(0)
  expect(pipe.stdout.includes('fixture-password')).toBe(false)
  expect(check.stdout.includes('fixture-password')).toBe(false)
})
