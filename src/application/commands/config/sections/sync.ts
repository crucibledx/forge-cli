import {SYNC_CONFIG_DEFAULTS} from '@domain/config/types'
import {promptSyncSettings, SYNC_PROMPT_MESSAGES} from '@application/commands/shared/sync.prompt'

import {sectionsRegistry} from './registry'
import type {ConfigSectionEntry} from './types'

// ─── Messages ────────────────────────────────────────────────────────────────

export const SYNC_SECTION_MESSAGES = {
  hintDefault: 'using defaults',
  hintCustom: (parts: string[]) => parts.join(', '),
} as const

// ─── Helpers ─────────────────────────────────────────────────────────────────

function describeSyncHint(sync?: Record<string, unknown>): string {
  if (!sync) return SYNC_SECTION_MESSAGES.hintDefault

  const parts: string[] = []
  const d = SYNC_CONFIG_DEFAULTS

  if (sync.source_conflict_strategy && sync.source_conflict_strategy !== d.source_conflict_strategy)
    parts.push(`source: ${sync.source_conflict_strategy}`)
  if (sync.local_conflict_strategy && sync.local_conflict_strategy !== d.local_conflict_strategy)
    parts.push(`local: ${sync.local_conflict_strategy}`)
  if (sync.backup === false) parts.push('backup: off')
  if (sync.keep_local === false) parts.push('keep-local: off')

  return parts.length > 0 ? SYNC_SECTION_MESSAGES.hintCustom(parts) : SYNC_SECTION_MESSAGES.hintDefault
}

// ─── Section entry ───────────────────────────────────────────────────────────

export const syncSection: ConfigSectionEntry = {
  id: 'sync',
  label: `Sync settings`,

  hint: (config) => describeSyncHint(config.sync as Record<string, unknown> | undefined),

  edit: async (config) => {
    const settings = await promptSyncSettings(config.sync)
    return {...config, sync: {...(config.sync ?? {}), ...settings}}
  },
}

export {SYNC_PROMPT_MESSAGES}

sectionsRegistry.push(syncSection)
