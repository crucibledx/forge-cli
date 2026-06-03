export const LOG_LEVELS = {
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR',
} as const

export type LogLevel = (typeof LOG_LEVELS)[keyof typeof LOG_LEVELS]

export interface LogEntry {
  timestamp: string
  level: LogLevel
  message: string
}

export interface SchedulerLogger {
  info: (message: string) => Promise<void>
  warn: (message: string) => Promise<void>
  error: (message: string) => Promise<void>
  readRecent: (maxLines?: number) => Promise<LogEntry[]>
  getLogPath: () => string
}
