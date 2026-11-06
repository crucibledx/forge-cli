import {join} from 'node:path'

import {useTmpDir} from '@test-helpers/tmp'
import {describe, expect, it} from 'bun:test'

import {createTranscript, TAIL_BYTES} from '../process'
import {spawnPty} from '../spawn'

const fixture = join(import.meta.dir, 'fixtures/process.ts')

describe('BR-09 PTY contracts (AC-17)', () => {
  const dir = useTmpDir('pty')
  it('AC-17 an actual PTY cannot match its consumed prompt after an ANSI cut and child exit', async () => {
    const program = `
const echo = Bun.spawnSync(['stty','-echo'], {stdin:'inherit',stdout:'pipe',stderr:'pipe'})
if (echo.exitCode !== 0) throw new Error('Cannot disable echo in owned PTY')
await Bun.write(Bun.stdout, '\\x1b[?25l>')
for await (const chunk of Bun.stdin.stream()) { break }
await Bun.write(Bun.stdout, Buffer.alloc(${TAIL_BYTES - 4}, 120))
`
    const cli = spawnPty(dir(), [process.execPath, '-e', program])
    try {
      await cli.waitForText('>').pressEnter()
      expect((await cli.waitForExit()).exitCode).toBe(0)
      await expect(cli.waitForText('>', 200)).rejects.toThrow('exited/closed')
    } finally {
      await cli.dispose()
    }
  })
  it.each(['\x1b[?25l', '\x1b]0;title\x07', '\x1b]8;;https://fixture.invalid\x1b\\', '\u009b31m', '\x1b(B'])(
    'AC-17 control fragments across every chunk boundary never become visible: %j',
    (control) => {
      for (let cut = 0; cut <= control.length; cut++) {
        const transcript = createTranscript()
        transcript.append(Buffer.from('before終' + control.slice(0, cut)))
        expect(transcript.text()).toBe('before終')
        transcript.append(Buffer.from(control.slice(cut) + '>after'))
        transcript.finish()
        expect(transcript.text()).toBe('before終>after')
      }
    },
  )
  it('AC-17 unfinished OSC payload is bounded and remains hidden across raw-tail loss', () => {
    const transcript = createTranscript()
    transcript.append(Buffer.from('before\x1b]' + 'x'.repeat(TAIL_BYTES * 2)))
    expect(transcript.text()).toBe('before')
    expect(Buffer.byteLength(transcript.rawText())).toBeLessThanOrEqual(TAIL_BYTES)
    transcript.append(Buffer.from('\x1b'))
    transcript.append(Buffer.from('\\>fresh'))
    expect(transcript.text()).toBe('before>fresh')
  })
  it.each(['\x1b[?25l>', '\x1b]0;title\x07>', '\x1b]8;;https://fixture.invalid\x1b\\>'])(
    'AC-17 consumed prompts cannot reappear after an ANSI tail cut: %j',
    (prefix) => {
      const transcript = createTranscript()
      transcript.append(Buffer.from(prefix))
      const consumed = transcript.offset + transcript.text().length
      expect(consumed).toBe(1)
      transcript.append(Buffer.from('x'.repeat(TAIL_BYTES - 4)))
      expect(transcript.text().indexOf('>', Math.max(0, consumed - transcript.offset))).toBe(-1)
      transcript.append(Buffer.from('>fresh'))
      expect(transcript.text().indexOf('>fresh', Math.max(0, consumed - transcript.offset))).toBeGreaterThanOrEqual(0)
    },
  )
  it('consumes repeated prompts, chaining actual input writes', async () => {
    const cli = spawnPty(dir(), [process.execPath, fixture, 'prompts'])
    try {
      await cli.waitForText('prompt> ')
      await expect(cli.waitForText('prompt> ', 25)).rejects.toThrow('wait expired')
      const start = cli.mark()
      await cli.waitForText('prompt> ', undefined, 0).write('n').waitForText('prompt> ', undefined, start).write('q')
      const result = await cli.waitForExit()
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('')
      expect(result.stderr).toBe('')
    } finally {
      await cli.dispose()
    }
  })
  it('marks distinguish prompts emitted in one chunk', async () => {
    const cli = spawnPty(dir(), [process.execPath, fixture, 'batch'])
    const start = cli.mark()
    await cli.waitForText('second')
    await cli.waitForText('first')
    await cli.waitForText('first', undefined, start)
    await cli.waitForExit()
  })
  it('early exit rejects an unmet wait, and write failures are awaited', async () => {
    const cli = spawnPty(dir(), [process.execPath, fixture, 'early'])
    await expect(cli.waitForText('never')).rejects.toThrow('exited')
    expect((await cli.waitForExit()).exitCode).toBe(7)
    await expect(cli.waitForText('finished', undefined, 0).write('late')).rejects.toThrow('closed PTY')
  })
  it('streams split Unicode in the combined transcript', async () => {
    const cli = spawnPty(dir(), [process.execPath, fixture, 'unicode'])
    await cli.waitForText('🌍')
    const result = await cli.waitForExit()
    expect(result.output).not.toContain('�')
    expect(result.output).toContain('終')
  })
})
