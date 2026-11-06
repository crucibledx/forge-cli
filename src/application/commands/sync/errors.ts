import {redact} from '@domain/redact'

import {CommandError} from '../types'

export class SafetyError extends CommandError {
  constructor(
    message: string,
    readonly errorCount = 1,
  ) {
    super(redact(message), 'Correct the source/path or conflict policy, then run forge sync --dry-run before applying.')
  }
}
