import {existsSync} from 'node:fs'
import {appendFile, mkdir, readFile} from 'node:fs/promises'
import {homedir} from 'node:os'
import {join} from 'node:path'

import type {LogEntry, LogLevel, SchedulerLogger} from './types'
import {LOG_LEVELS} from './types'

const LOG_DIR = join(homedir(), '.crucible', 'logs', 'scheduled')
const LOG_FILE = 'forge.sync.log'
const DEFAULT_MAX_LINES = 50

function formatTimestamp(): string {
  return new Date().toISOString()
}

function formatLine(level: LogLevel, message: string): string {
  return `[${formatTimestamp()}] ${level} | ${message}\n`
}

function parseLine(line: string): LogEntry | null {
  const match = line.match(/^\[(.+?)] (INFO|WARN|ERROR) \| (.+)$/)
  if (!match) return null
  return {timestamp: match[1], level: match[2] as LogLevel, message: match[3]}
}

async function ensureLogDir(): Promise<void> {
  if (!existsSync(LOG_DIR)) {
    await mkdir(LOG_DIR, {recursive: true})
  }
}

export function createSchedulerLogger(): SchedulerLogger {
  const logPath = join(LOG_DIR, LOG_FILE)

  async function write(level: LogLevel, message: string): Promise<void> {
    await ensureLogDir()
    await appendFile(logPath, formatLine(level, message))
  }

  return {
    info: (message) => write(LOG_LEVELS.INFO, message),
    warn: (message) => write(LOG_LEVELS.WARN, message),
    error: (message) => write(LOG_LEVELS.ERROR, message),

    async readRecent(maxLines = DEFAULT_MAX_LINES): Promise<LogEntry[]> {
      if (!existsSync(logPath)) return []

      const content = await readFile(logPath, 'utf-8')
      const lines = content.trim().split('\n').filter(Boolean)

      return lines
        .slice(-maxLines)
        .map(parseLine)
        .filter((e): e is LogEntry => e !== null)
    },

    getLogPath: () => logPath,
  }
}

export function getLogPath(): string {
  return join(LOG_DIR, LOG_FILE)
}
