import {repositoryRoot} from '../../scripts/repository-root'
import {createTranscript, diagnosticHead, diagnosticJSON, diagnosticTail, sanitize, TAIL_BYTES} from './process'

interface SessionContext {
  command: readonly string[]
  cwd: string
  exit: number | null
  signal: string | null
  timedOut: boolean
  timeoutMs: number
  seed: string | null
  replay: string | null
}
const formattedFailures = new WeakMap<Error, {summary: string; details: string}>()

/** One bounded private failure envelope for pipe and PTY compatibility runners. */
export function sessionFailure(
  errors: readonly unknown[],
  context: SessionContext,
  output: string,
  secrets: string[] = [],
): Error {
  const safe = (text: string, leadingBytes?: number) => {
    const view = createTranscript((value) => {
      const cleaned = sanitize(value, context.cwd, secrets)
        .replaceAll(repositoryRoot, '<repository>')
        .replaceAll(process.execPath, '<runtime>')
      return leadingBytes === undefined ? cleaned : diagnosticHead(cleaned, leadingBytes)
    }, secrets)
    view.append(Buffer.from(text))
    const leading = view.visibleDiagnostic()
    view.finish()
    return leadingBytes === undefined ? view.visibleDiagnostic() : leading
  }
  const messages = errors.map((error) =>
    error instanceof Error ? (formattedFailures.get(error)?.summary ?? error.message) : String(error),
  )
  const summaries = diagnosticHead(
    messages
      .map(
        (message, index) =>
          `${errors[index] instanceof Error && !formattedFailures.has(errors[index]) ? safe(errors[index].name, 64) + ': ' : ''}${safe(message, 1024)}`,
      )
      .join('\n'),
    TAIL_BYTES / 8,
  )
  const detailBudget = Math.floor(TAIL_BYTES / 8 / Math.max(1, errors.length))
  const details = diagnosticTail(
    errors
      .map((error, index) =>
        diagnosticTail(
          safe(
            error instanceof Error
              ? (formattedFailures.get(error)?.details ?? error.stack ?? messages[index])
              : messages[index],
          ),
          detailBudget,
        ),
      )
      .join('\n'),
    TAIL_BYTES / 8,
  )
  const command = context.command
    .slice(0, 16)
    .map((part, index) =>
      index && ['-e', '--eval', '-p', '--print'].includes(context.command[index - 1])
        ? '<inline program>'
        : diagnosticJSON(safe(part, 1024), 1024),
    )
  if (context.command.length > command.length) command.push('<additional arguments omitted>')
  // Bound fields before serialization, so truncation cannot remove keys or break the envelope.
  const metadata = JSON.stringify({
    ...context,
    command,
    cwd: '.',
    signal: context.signal === null ? null : diagnosticJSON(safe(context.signal, 64), 64),
    seed: context.seed === null ? null : diagnosticJSON(safe(context.seed, 1024), 1024),
    replay: context.replay === null ? null : diagnosticJSON(safe(context.replay, 1024), 1024),
  })
  const error = new Error(
    `${summaries}\nDetails:\n${details}\nSession: ${metadata}\nTranscript tail:\n${diagnosticTail(safe(output), TAIL_BYTES / 2)}`,
  )
  if (errors[0] instanceof Error) error.name = safe(errors[0].name, 64)
  // The message's fields are already private. Re-redacting its JSON can consume delimiters.
  const frames = safe((new Error().stack ?? '').split('\n').slice(1).join('\n'))
  const prefix = `${error.name}: ${error.message}\n`
  error.stack = prefix + diagnosticTail(frames, Math.max(0, TAIL_BYTES - Buffer.byteLength(prefix)))
  formattedFailures.set(error, {summary: summaries, details})
  return error
}
