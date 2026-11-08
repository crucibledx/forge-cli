import {expect, it} from 'bun:test'

import {createAnsiText} from './ansi-text'

it.each(['\x1bP', '\x1b_', '\x1b^', '\x1bX', '\u0090', '\u009f', '\u009e', '\u0098'])(
  'AC-16,17 control-string payload stays invisible across every stream boundary: %j',
  (open) => {
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
it('AC-16,17 OSC still accepts BEL, but an unfinished control-string payload remains discarded', () => {
  expect(createAnsiText()('a\x1b]title\x07b')).toBe('ab')
  const plain = createAnsiText()
  expect(plain('to\x1bP' + 'x'.repeat(262144))).toBe('to')
  expect(plain('still invisible\x1b')).toBe('')
  expect(plain('\\ken')).toBe('ken')
})
