/**
 * All user-facing prompt messages for `forge init`.
 *
 * Centralised here so tests reference the same strings as the handler.
 * Change text in one place and tests stay in sync automatically.
 *
 * Shared prompt messages (assistant selection, source type) are re-exported
 * from the shared/ module so both init and config use the same strings.
 */

import {ASSISTANT_PROMPT_MESSAGES as AP} from '@application/commands/shared/assistant.prompt'
import {SOURCE_PROMPT_MESSAGES as SP} from '@application/commands/shared/source.prompt'

export const INIT_MESSAGES = {
  intro: 'Forge — AI Environment Setup',
  outro: 'Run `forge sync` to fetch shared skills',
  outroNoSource: 'Done. Add a source to .crucible/forge.config.yaml to enable sync.',
  outroCancelled: 'Cancelled — existing config preserved',

  detected: 'Detected:',
  configExists: 'Existing .crucible/forge.config.yaml found. Edit it manually or run `forge config`.',
  configWrittenTo: (path: string) => `Config written to ${path}`,

  assistants: {
    select: AP.select,
    detectedHint: AP.detectedHint,
    detectedGlobalHint: AP.detectedGlobalHint,
    noneSelected: AP.noneSelected,
  },

  source: {
    addSource: 'Add a shared skills source?',
    addAnother: 'Add another source?',
    selectType: SP.selectType,
  },

  scheduler: {
    installNow: 'Install the scheduler now?',
    installed: 'Scheduler installed.',
    failed: (error: string) => `Failed to install scheduler: ${error}`,
  },

  sync: {
    runNow: 'Run forge sync now?',
  },
} as const
