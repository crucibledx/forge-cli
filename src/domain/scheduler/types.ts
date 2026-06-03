export const SCHEDULER_STATUSES = {
  INSTALLED: 'installed',
  NOT_INSTALLED: 'not_installed',
} as const

export type SchedulerStatus = (typeof SCHEDULER_STATUSES)[keyof typeof SCHEDULER_STATUSES]

export interface SchedulerState {
  status: SchedulerStatus
  schedule?: string
  lastRun?: string
  lastRunSuccess?: boolean
  logPath: string
}
