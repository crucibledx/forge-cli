import {CronExpressionParser} from 'cron-parser'
import cronstrue from 'cronstrue'

export function isValidCron(expression: string): boolean {
  try {
    const result = Bun.cron.parse(expression.trim())
    return result !== null
  } catch {
    return false
  }
}

export function describeCron(expression: string): string {
  try {
    return cronstrue.toString(expression.trim(), {use24HourTimeFormat: true})
  } catch {
    return expression
  }
}

export function nextCronRun(expression: string, from: Date = new Date()): Date | null {
  try {
    const cron = CronExpressionParser.parse(expression.trim(), {currentDate: from})
    return cron.next().toDate()
  } catch {
    return null
  }
}
