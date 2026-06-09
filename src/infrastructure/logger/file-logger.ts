import {existsSync, mkdirSync, readdirSync, unlinkSync} from 'node:fs'
import {readFile} from 'node:fs/promises'
import {homedir} from 'node:os'
import {join} from 'node:path'

import pino from 'pino'

import type {FileLogger, LogEntry, LogLevel} from './types'
import {LOG_LEVELS} from './types'

const LOG_DIR = join(homedir(), '.crucible', 'forge', 'logs')
const DEFAULT_MAX_LINES = 50
const DEFAULT_MAX_AGE_DAYS = 30

let currentLogLevel: LogLevel = LOG_LEVELS.INFO

export function setLogLevel(level: LogLevel): void {
  currentLogLevel = level
}

export function getLogLevel(): LogLevel {
  return currentLogLevel
}

function todayLogFile(): string {
  return `forge-${new Date().toISOString().slice(0, 10)}.jsonl`
}

function ensureLogDir(): void {
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, {recursive: true})
  }
}

function parseLine(line: string): LogEntry | null {
  try {
    const obj = JSON.parse(line)
    if (!obj.ts || !obj.level || !obj.msg) return null
    return obj as LogEntry
  } catch {
    return null
  }
}

export function createFileLogger(level: LogLevel = currentLogLevel): FileLogger {
  ensureLogDir()

  const logPath = join(LOG_DIR, todayLogFile())
  const dest = pino.destination({dest: logPath, sync: true, mkdir: true})

  const logger = pino(
    {
      level,
      formatters: {
        level: (label) => ({level: label}),
      },
      timestamp: () => `,"ts":"${new Date().toISOString()}"`,
      base: undefined,
    },
    dest,
  )

  function write(lvl: pino.Level, msg: string, data?: Record<string, unknown>): void {
    if (data) {
      logger[lvl](data, msg)
    } else {
      logger[lvl](msg)
    }
  }

  return {
    error: (msg, data) => write(LOG_LEVELS.ERROR, msg, data),
    warn: (msg, data) => write(LOG_LEVELS.WARN, msg, data),
    info: (msg, data) => write(LOG_LEVELS.INFO, msg, data),
    debug: (msg, data) => write(LOG_LEVELS.DEBUG, msg, data),
    trace: (msg, data) => write(LOG_LEVELS.TRACE, msg, data),

    async readRecent(maxLines = DEFAULT_MAX_LINES): Promise<LogEntry[]> {
      if (!existsSync(LOG_DIR)) return []

      const files = readdirSync(LOG_DIR)
        .filter((f) => f.startsWith('forge-') && f.endsWith('.jsonl'))
        .sort()

      const entries: LogEntry[] = []

      for (const file of files.slice(-5)) {
        const content = await readFile(join(LOG_DIR, file), 'utf-8')
        const lines = content.trim().split('\n').filter(Boolean)
        entries.push(...lines.map(parseLine).filter((e): e is LogEntry => e !== null))
      }

      return entries.slice(-maxLines)
    },

    async rotate(maxAgeDays = DEFAULT_MAX_AGE_DAYS): Promise<void> {
      if (!existsSync(LOG_DIR)) return

      const cutoff = new Date()
      cutoff.setDate(cutoff.getDate() - maxAgeDays)
      const cutoffStr = cutoff.toISOString().slice(0, 10)

      const files = readdirSync(LOG_DIR).filter((f) => f.startsWith('forge-') && f.endsWith('.jsonl'))

      for (const file of files) {
        const dateStr = file.replace('forge-', '').replace('.jsonl', '')
        if (dateStr < cutoffStr) {
          unlinkSync(join(LOG_DIR, file))
        }
      }
    },

    getLogDir: () => LOG_DIR,

    flush(): void {
      dest.flushSync()
    },
  }
}

export function getLogDir(): string {
  return LOG_DIR
}
