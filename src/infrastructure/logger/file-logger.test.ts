import {describe, expect, it} from 'bun:test'

describe('file-logger (integration)', () => {
  it('logger interface has expected methods', async () => {
    const {createSchedulerLogger} = await import('./file-logger')
    const logger = createSchedulerLogger()

    // Just verify the logger interface exists and has expected methods
    expect(typeof logger.info).toBe('function')
    expect(typeof logger.warn).toBe('function')
    expect(typeof logger.error).toBe('function')
    expect(typeof logger.readRecent).toBe('function')
    expect(typeof logger.rotate).toBe('function')
    expect(typeof logger.getLogPath).toBe('function')
  })

  it('getLogPath returns expected path', async () => {
    const {getLogPath} = await import('./file-logger')
    const path = getLogPath()

    expect(path).toContain('.crucible')
    expect(path).toContain('forge.sync.log')
  })
})
