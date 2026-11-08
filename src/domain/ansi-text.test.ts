import {expect, it} from 'bun:test'

import {createAnsiText} from './ansi-text'

const controlStrings = ['\x1bP', '\x1b_', '\x1b^', '\x1bX', '\u0090', '\u009f', '\u009e', '\u0098'].map(
  (open, label) => ({open, label}),
)
it.each(controlStrings)(
  'AC-16,17 control-string payload stays invisible across every stream boundary: form $label',
  ({open}) => {
    const close = open.startsWith('\x1b') ? '\x1b\\' : '\u009c'
    const input = `to${open}junk\x07more${close}ken`
    for (let cut = 0; cut <= input.length; cut++) {
      const segments: {start: number; end: number}[] = []
      const plain = createAnsiText((start, end) => segments.push({start, end}))
      expect(plain(input.slice(0, cut)) + plain(input.slice(cut))).toBe('token')
      expect(segments.every(({start, end}) => end > start)).toBe(true)
    }
    const plain = createAnsiText()
    expect([...input].map((char) => plain(char)).join('')).toBe('token')
  },
)
it.each(
  [...controlStrings, {open: '\x1b]', label: 8}, {open: '\u009d', label: 9}].flatMap(({open, label}) =>
    ['\x18', '\x1a'].flatMap((cancel, kind) =>
      ['', '\x1b'].map((escape, split) => ({open, cancel, escape, label: `${label}/${kind}/${split}`})),
    ),
  ),
)('AC-16,17 CAN/SUB cancels control strings across every cut: $label', ({open, cancel, escape}) => {
  const input = `to${open}junk${escape}${cancel}ken`
  for (let cut = 0; cut <= input.length; cut++) {
    const plain = createAnsiText()
    expect(plain(input.slice(0, cut)) + plain(input.slice(cut))).toBe('token')
  }
  const plain = createAnsiText()
  expect([...input].map(plain).join('')).toBe('token')
})
it.each(['\x18', '\x1a'])('AC-16,17 cancellation resumes text from every non-string parser state: %#', (cancel) => {
  for (const prefix of ['', '\x1b', '\x1b ', '\x1b[12;', '\u009b12;']) {
    const input = `to${prefix}${cancel}ken`
    for (let cut = 0; cut <= input.length; cut++) {
      const plain = createAnsiText()
      expect(plain(input.slice(0, cut)) + plain(input.slice(cut))).toBe('token')
    }
  }
})
it('AC-16,17 OSC still accepts BEL, but an unfinished control-string payload remains discarded', () => {
  expect(createAnsiText()('a\x1b]title\x07b')).toBe('ab')
  const plain = createAnsiText()
  expect(plain('to\x1bP' + 'x'.repeat(262144))).toBe('to')
  expect(plain('still invisible\x1b')).toBe('')
  expect(plain('\\ken')).toBe('ken')
})
