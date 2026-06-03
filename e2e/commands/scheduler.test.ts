import {join} from 'node:path'

import {describe, expect, it} from 'bun:test'

import {SCHEDULER_MESSAGES as M} from '@application/commands/scheduler/messages'
import {SHARED_MESSAGES} from '@application/commands/shared'

import {buildConfigYaml, writeConfig, writeSourceTree} from '../fixtures'
import {runScheduler, useTmpDir} from '../framework'

const TIMEOUT = 30_000

describe('forge scheduler', () => {
  const getDir = useTmpDir('scheduler-e2e')

  describe('without config', () => {
    it(
      'install fails with no config message',
      async () => {
        const {output, exitCode} = await runScheduler(getDir(), 'install')
        expect(exitCode).not.toBe(0)
        expect(output).toContain(SHARED_MESSAGES.errors.noConfig)
      },
      TIMEOUT,
    )

    it(
      'status fails with no config message',
      async () => {
        const {output, exitCode} = await runScheduler(getDir(), 'status')
        expect(exitCode).not.toBe(0)
        expect(output).toContain(SHARED_MESSAGES.errors.noConfig)
      },
      TIMEOUT,
    )
  })

  describe('without schedule in config', () => {
    it(
      'install fails with no schedule message',
      async () => {
        const dir = getDir()
        const sourceDir = join(dir, 'source')
        await writeSourceTree(sourceDir, {rules: {'api.md': '# rules'}})
        await writeConfig(
          dir,
          buildConfigYaml({
            assistants: ['claude-code'],
            localSource: {path: sourceDir},
          }),
        )

        const {output, exitCode} = await runScheduler(dir, 'install')
        expect(exitCode).not.toBe(0)
        expect(output).toContain(M.errors.noSchedule)
      },
      TIMEOUT,
    )
  })

  describe('with schedule in config', () => {
    it(
      'install succeeds and status shows installed',
      async () => {
        const dir = getDir()
        const sourceDir = join(dir, 'source')
        await writeSourceTree(sourceDir, {rules: {'api.md': '# rules'}})
        await writeConfig(
          dir,
          buildConfigYaml({
            assistants: ['claude-code'],
            localSource: {path: sourceDir},
            sync: {schedule: '0 9 * * 1'},
          }),
        )

        const install = await runScheduler(dir, 'install')
        expect(install.exitCode).toBe(0)
        expect(install.output).toContain('Scheduler installed')

        const status = await runScheduler(dir, 'status')
        expect(status.exitCode).toBe(0)
        expect(status.output).toContain('Scheduler: installed')

        // Cleanup: uninstall the registered job
        await runScheduler(dir, 'uninstall')
      },
      TIMEOUT,
    )
  })

  describe('uninstall', () => {
    it(
      'reports not installed when no job exists',
      async () => {
        const dir = getDir()
        const sourceDir = join(dir, 'source')
        await writeSourceTree(sourceDir, {rules: {'api.md': '# rules'}})
        await writeConfig(
          dir,
          buildConfigYaml({
            assistants: ['claude-code'],
            localSource: {path: sourceDir},
          }),
        )

        const {output, exitCode} = await runScheduler(dir, 'uninstall')
        expect(exitCode).toBe(0)
        expect(output).toContain(M.output.notInstalled)
      },
      TIMEOUT,
    )
  })

  describe('with invalid cron', () => {
    it(
      'install fails with invalid cron message',
      async () => {
        const dir = getDir()
        const sourceDir = join(dir, 'source')
        await writeSourceTree(sourceDir, {rules: {'api.md': '# rules'}})
        await writeConfig(
          dir,
          buildConfigYaml({
            assistants: ['claude-code'],
            localSource: {path: sourceDir},
            sync: {schedule: 'not-a-cron'},
          }),
        )

        const {output, exitCode} = await runScheduler(dir, 'install')
        expect(exitCode).not.toBe(0)
        expect(output).toContain('Invalid cron expression')
      },
      TIMEOUT,
    )
  })
})
