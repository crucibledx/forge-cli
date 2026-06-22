import {TELEMETRY_DEFAULTS} from '@domain/config/types'
import * as prompts from '@infrastructure/cli/prompts'

import {sectionsRegistry} from './registry'
import type {ConfigSectionEntry} from './types'

// ─── Messages ────────────────────────────────────────────────────────────────

export const TELEMETRY_SECTION_MESSAGES = {
  hintEnabled: 'enabled',
  hintDisabled: 'disabled',
  toggle: 'Enable anonymous telemetry? (local only, no data sent)',
} as const

// ─── Section entry ───────────────────────────────────────────────────────────

export const telemetrySection: ConfigSectionEntry = {
  id: 'telemetry',
  label: 'Telemetry',

  hint: (config) => {
    const enabled = config.telemetry?.enabled ?? TELEMETRY_DEFAULTS.enabled
    return enabled ? TELEMETRY_SECTION_MESSAGES.hintEnabled : TELEMETRY_SECTION_MESSAGES.hintDisabled
  },

  edit: async (config) => {
    const current = config.telemetry?.enabled ?? TELEMETRY_DEFAULTS.enabled
    const enabled = await prompts.confirm({
      message: TELEMETRY_SECTION_MESSAGES.toggle,
      initialValue: current,
    })
    return {...config, telemetry: {...(config.telemetry ?? {}), enabled}}
  },
}

sectionsRegistry.push(telemetrySection)
