import type {LocalConflictStrategy, SourceConflictStrategy, SyncConfig} from '@domain/config/types'
import {LOCAL_CONFLICT_STRATEGIES, SOURCE_CONFLICT_STRATEGIES, SYNC_CONFIG_DEFAULTS} from '@domain/config/types'
import * as prompts from '@infrastructure/cli/prompts'

// ─── Messages ────────────────────────────────────────────────────────────────

export const SYNC_PROMPT_MESSAGES = {
  gate: 'Configure sync settings? (conflict strategies, backup, keep-local)',
  sourceConflict: {
    message: 'Source conflict strategy:',
    options: [
      {value: SOURCE_CONFLICT_STRATEGIES.LAST_WINS, label: 'Last wins', hint: 'latest source overrides earlier ones'},
      {value: SOURCE_CONFLICT_STRATEGIES.FIRST_WINS, label: 'First wins', hint: 'first source takes priority'},
      {value: SOURCE_CONFLICT_STRATEGIES.ERROR, label: 'Error', hint: 'abort on conflict between sources'},
    ],
  },
  localConflict: {
    message: 'Local conflict strategy:',
    options: [
      {
        value: LOCAL_CONFLICT_STRATEGIES.REMOTE_WINS,
        label: 'Remote wins',
        hint: 'source always overwrites local edits',
      },
      {value: LOCAL_CONFLICT_STRATEGIES.LOCAL_WINS, label: 'Local wins', hint: 'keep local edits, skip remote'},
      {value: LOCAL_CONFLICT_STRATEGIES.ERROR, label: 'Error', hint: 'abort on conflict with local changes'},
    ],
  },
  backup: 'Create backups before overwriting files?',
  keepLocal: 'Keep locally-created files that are not in any source?',
} as const

// ─── Prompts ─────────────────────────────────────────────────────────────────

export async function promptSyncSettings(current?: Partial<SyncConfig>): Promise<Partial<SyncConfig>> {
  const M = SYNC_PROMPT_MESSAGES
  const defaults = {...SYNC_CONFIG_DEFAULTS, ...current}

  const sourceConflict = (await prompts.select({
    message: M.sourceConflict.message,
    options: M.sourceConflict.options.map((o) => ({
      ...o,
      hint: o.value === defaults.source_conflict_strategy ? `${o.hint} (current)` : o.hint,
    })),
  })) as SourceConflictStrategy

  const localConflict = (await prompts.select({
    message: M.localConflict.message,
    options: M.localConflict.options.map((o) => ({
      ...o,
      hint: o.value === defaults.local_conflict_strategy ? `${o.hint} (current)` : o.hint,
    })),
  })) as LocalConflictStrategy

  const backup = await prompts.confirm({
    message: M.backup,
    initialValue: defaults.backup,
  })

  const keepLocal = await prompts.confirm({
    message: M.keepLocal,
    initialValue: defaults.keep_local,
  })

  return {
    source_conflict_strategy: sourceConflict,
    local_conflict_strategy: localConflict,
    backup,
    keep_local: keepLocal,
  }
}
