export const LOG_LEVELS = {
  SILENT: 'silent',
  ERROR: 'error',
  WARN: 'warn',
  INFO: 'info',
  DEBUG: 'debug',
  TRACE: 'trace',
} as const

export type LogLevel = (typeof LOG_LEVELS)[keyof typeof LOG_LEVELS]

export interface LogEntry {
  ts: string
  level: LogLevel
  msg: string
  [key: string]: unknown
}

export interface FileLogger {
  error(msg: string, data?: Record<string, unknown>): void
  warn(msg: string, data?: Record<string, unknown>): void
  info(msg: string, data?: Record<string, unknown>): void
  debug(msg: string, data?: Record<string, unknown>): void
  trace(msg: string, data?: Record<string, unknown>): void
  readRecent(maxLines?: number): Promise<LogEntry[]>
  rotate(maxAgeDays?: number): Promise<void>
  getLogDir(): string
  flush(): void
}
