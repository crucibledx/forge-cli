const ANSI = {TEXT: 0, ESCAPE: 1, CSI: 2, OSC: 3, OSC_ESCAPE: 4, INTERMEDIATE: 5} as const
type AnsiState = (typeof ANSI)[keyof typeof ANSI]

/** Strip streamed control sequences without retaining unbounded unfinished payloads. Not a screen emulator. */
export function createAnsiText(onText?: (start: number, end: number) => void) {
  let state: AnsiState = ANSI.TEXT,
    bellTerminates = false
  return (chunk: string): string => {
    let text = '',
      index = 0
    while (index < chunk.length) {
      if (state === ANSI.TEXT) {
        const next = chunk.slice(index).search(/[\u0018\u001a\u001b\u0090\u0098\u009b-\u009f]/)
        if (next < 0) {
          text += chunk.slice(index)
          onText?.(index, chunk.length)
          break
        }
        text += chunk.slice(index, index + next)
        if (next) onText?.(index, index + next)
        const control = chunk[index + next]
        index += next + 1
        bellTerminates = control === '\u009d'
        state =
          control === '\u001b'
            ? ANSI.ESCAPE
            : control === '\u009b'
              ? ANSI.CSI
              : control === '\u009c' || control === '\u0018' || control === '\u001a'
                ? ANSI.TEXT
                : ANSI.OSC
        continue
      }
      if (state === ANSI.ESCAPE) {
        const control = chunk[index++]
        bellTerminates = control === ']'
        state =
          control === '['
            ? ANSI.CSI
            : ']P_^X'.includes(control)
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
            ? bellTerminates
              ? /[\u0007\u0018\u001a\u009c]|\u001b\\/
              : /[\u0018\u001a\u009c]|\u001b\\/
            : state === ANSI.CSI
              ? /[\u0018\u001a\u001b\u009b@-~]/
              : /[\u0018\u001a\u001b\u009b0-~]/,
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
