import {describeCron} from '@domain/scheduler'
import {promptSchedule} from '@application/commands/shared/scheduler.prompt'
import * as prompts from '@infrastructure/cli/prompts'
import * as renderer from '@infrastructure/cli/renderer'

import {sectionsRegistry} from './registry'
import type {ConfigSectionEntry} from './types'

// ─── Messages ────────────────────────────────────────────────────────────────

export const SCHEDULER_SECTION_MESSAGES = {
  action: 'What would you like to do?',
  actionSet: 'Set schedule',
  actionClear: 'Clear schedule',
  actionDone: 'Done',
  cleared: 'Schedule cleared.',
  hintNone: 'not configured',
} as const

// ─── Actions ─────────────────────────────────────────────────────────────────

const ACTION_SET = 'set'
const ACTION_CLEAR = 'clear'
const ACTION_DONE = 'done'

// ─── Section entry ───────────────────────────────────────────────────────────

export const schedulerSection: ConfigSectionEntry = {
  id: 'scheduler',
  label: 'Scheduler',

  hint: (config) => {
    const schedule = config.sync?.schedule
    if (!schedule) return SCHEDULER_SECTION_MESSAGES.hintNone
    return describeCron(schedule)
  },

  edit: async (config) => {
    const M = SCHEDULER_SECTION_MESSAGES
    const currentSchedule = config.sync?.schedule

    const options: Array<{value: string; label: string}> = [
      {value: ACTION_SET, label: M.actionSet},
      {value: ACTION_DONE, label: M.actionDone},
    ]
    if (currentSchedule) {
      options.splice(1, 0, {value: ACTION_CLEAR, label: M.actionClear})
    }

    const action = await prompts.select({message: M.action, options})

    if (action === ACTION_CLEAR) {
      const sync = {...(config.sync ?? {})}
      delete sync.schedule
      renderer.renderSuccess(M.cleared)
      return {...config, sync}
    }

    if (action === ACTION_SET) {
      const schedule = await promptSchedule(currentSchedule)
      if (schedule) {
        return {...config, sync: {...(config.sync ?? {}), schedule}}
      }
    }

    return config
  },
}

sectionsRegistry.push(schedulerSection)
