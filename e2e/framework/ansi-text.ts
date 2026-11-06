const ANSI = {TEXT: 0, ESCAPE: 1, CSI: 2, OSC: 3, OSC_ESCAPE: 4, INTERMEDIATE: 5} as const
type AnsiState = (typeof ANSI)[keyof typeof ANSI]

/** Strip streamed control sequences without retaining unbounded unfinished payloads. Not a screen emulator. */
export function createAnsiText() {
  let state: AnsiState = ANSI.TEXT
  return (chunk: string): string => {
    let text = '',
      index = 0
    while (index < chunk.length) {
      if (state === ANSI.TEXT) {
        const next = chunk.slice(index).search(/[\u001b\u009b\u009d]/)
        if (next < 0) {
          text += chunk.slice(index)
          break
        }
        text += chunk.slice(index, index + next)
        const control = chunk[index + next]
        index += next + 1
        state = control === '\u009b' ? ANSI.CSI : control === '\u009d' ? ANSI.OSC : ANSI.ESCAPE
        continue
      }
      if (state === ANSI.ESCAPE) {
        const control = chunk[index++]
        state =
          control === '['
            ? ANSI.CSI
            : control === ']'
              ? ANSI.OSC
              : /[ -/]/.test(control)
                ? ANSI.INTERMEDIATE
                : control === '\u001b'
                  ? ANSI.ESCAPE
                  : ANSI.TEXT
        continue
      }
      if (state === ANSI.OSC_ESCAPE) {
        if (chunk[index] === '\\') {
          index++
          state = ANSI.TEXT
        } else state = ANSI.OSC
        continue
      }
      const next = chunk
        .slice(index)
        .search(
          state === ANSI.OSC
            ? /[\u0007\u009c]|\u001b\\/
            : state === ANSI.CSI
              ? /[\u001b\u009b@-~]/
              : /[\u001b\u009b0-~]/,
        )
      if (next < 0) {
        if (state === ANSI.OSC && chunk.endsWith('\u001b')) state = ANSI.OSC_ESCAPE
        break
      }
      index += next
      const control = chunk[index++]
      if (state === ANSI.OSC) {
        if (control === '\u001b') index++
        state = ANSI.TEXT
      } else state = control === '\u001b' ? ANSI.ESCAPE : control === '\u009b' ? ANSI.CSI : ANSI.TEXT
    }
    return text
  }
}
