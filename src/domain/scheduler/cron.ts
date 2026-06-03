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
