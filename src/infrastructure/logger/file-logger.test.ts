import {existsSync, mkdirSync, readdirSync, writeFileSync} from 'node:fs'
import {readFile, rm} from 'node:fs/promises'
import {join} from 'node:path'

import {afterAll, beforeAll, describe, expect, it} from 'bun:test'

import {LOG_LEVELS} from './types'

const TEST_LOG_DIR = join(import.meta.dir, '__test-logs__')

describe('file-logger', () => {
  it('interface has expected methods', async () => {
    const {createFileLogger} = await import('./file-logger')
    const logger = createFileLogger()

    expect(typeof logger.info).toBe('function')
    expect(typeof logger.warn).toBe('function')
    expect(typeof logger.error).toBe('function')
    expect(typeof logger.debug).toBe('function')
    expect(typeof logger.trace).toBe('function')
    expect(typeof logger.readRecent).toBe('function')
    expect(typeof logger.rotate).toBe('function')
    expect(typeof logger.getLogDir).toBe('function')
    expect(typeof logger.flush).toBe('function')
  })

  it('getLogDir returns path with .crucible/forge/logs', async () => {
    const {getLogDir} = await import('./file-logger')
    const dir = getLogDir()

    expect(dir).toContain('.crucible')
    expect(dir).toContain('forge')
    expect(dir).toContain('logs')
  })
})

describe('log level state', () => {
  it('defaults to info', async () => {
    const {getLogLevel} = await import('./file-logger')
    expect(getLogLevel()).toBe(LOG_LEVELS.INFO)
  })

  it('can be changed with setLogLevel', async () => {
    const {getLogLevel, setLogLevel} = await import('./file-logger')
    setLogLevel(LOG_LEVELS.DEBUG)
    expect(getLogLevel()).toBe(LOG_LEVELS.DEBUG)
    setLogLevel(LOG_LEVELS.INFO)
  })
})

describe('log writing and reading', () => {
  let logDir: string

  beforeAll(() => {
    logDir = TEST_LOG_DIR
    if (!existsSync(logDir)) mkdirSync(logDir, {recursive: true})
  })

  afterAll(async () => {
    await rm(TEST_LOG_DIR, {recursive: true, force: true})
  })

  it('writes structured JSON lines to file', async () => {
    const {createFileLogger} = await import('./file-logger')
    const logger = createFileLogger()
    logger.info('test message', {source: 'team-rules'})
    logger.flush()

    const dir = logger.getLogDir()
    const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
    expect(files.length).toBeGreaterThanOrEqual(1)

    const latestFile = files.sort().pop()!
    const content = await readFile(join(dir, latestFile), 'utf-8')
    const lines = content.trim().split('\n').filter(Boolean)
    const lastLine = JSON.parse(lines[lines.length - 1])

    expect(lastLine.level).toBe('info')
    expect(lastLine.msg).toBe('test message')
    expect(lastLine.source).toBe('team-rules')
    expect(lastLine.ts).toBeDefined()
    expect(lastLine.pid).toBeUndefined()
    expect(lastLine.hostname).toBeUndefined()
  })

  it('readRecent returns parsed log entries', async () => {
    const {createFileLogger} = await import('./file-logger')
    const logger = createFileLogger()
    logger.info('read-test')
    logger.flush()

    const entries = await logger.readRecent(5)
    expect(entries.length).toBeGreaterThanOrEqual(1)

    const last = entries[entries.length - 1]
    expect(last.level).toBe('info')
    expect(last.msg).toBe('read-test')
    expect(last.ts).toBeDefined()
  })

  it('respects log level filtering', async () => {
    const {createFileLogger} = await import('./file-logger')
    const logger = createFileLogger(LOG_LEVELS.ERROR)
    const beforeEntries = await logger.readRecent(10_000)
    const beforeCount = beforeEntries.length

    logger.info('should not appear')
    logger.debug('also hidden')
    logger.error('should appear')
    logger.flush()

    const afterEntries = await logger.readRecent(10_000)
    const newEntries = afterEntries.slice(beforeCount)

    expect(newEntries).toHaveLength(1)
    expect(newEntries[0].msg).toBe('should appear')
  })
})

describe('log rotation', () => {
  const rotationDir = join(import.meta.dir, '__test-rotation__')

  beforeAll(() => {
    mkdirSync(rotationDir, {recursive: true})
  })

  afterAll(async () => {
    await rm(rotationDir, {recursive: true, force: true})
  })

  it('rotation deletes files older than maxAgeDays', async () => {
    const oldDate = '2020-01-01'
    const recentDate = new Date().toISOString().slice(0, 10)

    writeFileSync(
      join(rotationDir, `forge-${oldDate}.jsonl`),
      '{"level":"info","ts":"2020-01-01T00:00:00Z","msg":"old"}\n',
    )
    writeFileSync(join(rotationDir, `forge-${recentDate}.jsonl`), '{"level":"info","ts":"now","msg":"recent"}\n')

    const {createFileLogger} = await import('./file-logger')
    const logger = createFileLogger()
    await logger.rotate(30)

    const dir = logger.getLogDir()
    const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
    const hasOld = files.some((f) => f.includes(oldDate))
    expect(hasOld).toBe(false)
  })
})
