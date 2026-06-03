import {describeCron, isValidCron} from '@domain/scheduler'
import * as prompts from '@infrastructure/cli/prompts'
import * as renderer from '@infrastructure/cli/renderer'

export const SCHEDULER_PROMPT_MESSAGES = {
  enableSchedule: 'Set up automatic sync schedule?',
  enterCron: 'Enter cron expression (e.g. "0 9 * * 1" = every Monday at 09:00):',
  enterCronEdit: 'Enter new cron expression (press Enter to keep current):',
  cronPlaceholder: '0 9 * * 1',
  invalidCron: 'Invalid cron expression. Use standard 5-field format (minute hour day month weekday).',
  schedulePreview: (desc: string) => `→ ${desc}`,
  confirmSchedule: 'Use this schedule?',
} as const

export async function promptSchedule(currentSchedule?: string): Promise<string | undefined> {
  const M = SCHEDULER_PROMPT_MESSAGES

  while (true) {
    const expression = await prompts.text({
      message: currentSchedule ? M.enterCronEdit : M.enterCron,
      placeholder: currentSchedule ?? M.cronPlaceholder,
      defaultValue: currentSchedule,
      validate: (value) => {
        if (!value || value.trim() === '') return undefined
        if (!isValidCron(value)) return M.invalidCron
        return undefined
      },
    })

    const trimmed = expression.trim()
    if (!trimmed) return undefined

    renderer.renderDim(M.schedulePreview(describeCron(trimmed)))

    const confirmed = await prompts.confirm({
      message: M.confirmSchedule,
      initialValue: true,
    })

    if (confirmed) return trimmed
  }
}
