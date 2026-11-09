import {expect, it} from 'bun:test'

import {terminalText} from './terminal-text'

it('AC-15,30 terminal fields visibly escape every C0/C1 control without changing ordinary Unicode', () => {
  const text = 'ordinary/é😀.md'
  expect(terminalText(text)).toBe(text)
  for (const code of [...Array.from({length: 32}, (_, i) => i), ...Array.from({length: 33}, (_, i) => i + 127)]) {
    const character = String.fromCharCode(code)
    expect(terminalText(`before${character}after`)).toBe(`before\\u${code.toString(16).padStart(4, '0')}after`)
  }
  for (const code of [
    0x61c, 0x200e, 0x200f, 0x2028, 0x2029, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069,
  ])
    expect(terminalText(String.fromCharCode(code))).toBe(`\\u${code.toString(16).padStart(4, '0')}`)
  expect(terminalText('👩‍💻/ملف.md')).toBe('👩‍💻/ملف.md')
})
it('AC-15,30 credential recognition precedes terminal escaping, including ANSI-fragmented secrets', () => {
  const text = terminalText('https://fixture.invalid?to\x1b[31mken=TERMINAL_PRIVATE&visible=yes')
  expect(text).not.toContain('TERMINAL_PRIVATE')
  expect(text).toContain('[redacted]')
  expect(text).toContain('visible=yes')
  expect(text).not.toContain('\x1b')
})
