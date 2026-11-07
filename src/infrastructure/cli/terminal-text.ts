import {redact} from '@domain/redact'

/** Redact before escaping, so formatted credentials stay private and untrusted text cannot drive a terminal. */
export function terminalText(text: string): string {
  return redact(text).replace(
    /[\p{Cc}\p{Bidi_Control}\u2028\u2029]/gu,
    (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
  )
}
