import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {join, resolve} from 'node:path'

import {syncFixture, trackedPath} from '@test-helpers/sync-fixture'
import {useTmpDir} from '@test-helpers/tmp'
import {afterEach, expect, it, spyOn} from 'bun:test'

import {runSyncWithDependencies} from '@application/commands/sync/handler'
import {transactionIO} from '@infrastructure/fs/transaction'
import {runPipe} from '@e2e/framework/pipe'

import {testEnvironment} from '../../../../scripts/test-sandbox'
import {handlerFixture, protectedBytes, readTree} from './helpers'

const dir = useTmpDir('silent-contract')
afterEach(() => {
  process.exitCode = 0
})
it.each([false, true].flatMap((failed) => [false, true].map((dryRun) => ({failed, dryRun}))))(
  'AC-23 real CLI raw silent exit/mutation parity, failed=$failed preview=$dryRun',
  async ({failed, dryRun}) => {
    const root = dir()
    await syncFixture(root)
    if (!failed) {
      await mkdir(join(root, 'upstream/rules'), {recursive: true})
      await writeFile(join(root, 'upstream/rules/a.md'), 'after')
    }
    const before = await protectedBytes(root)
    const reportDir = join(testEnvironment(root).HOME, '.crucible/forge/reports')
    const beforeReports = await readTree(reportDir)
    let raw: {stdout: string; stderr: string} | undefined
    const result = await runPipe(
      root,
      [
        process.execPath,
        resolve(import.meta.dir, '../../../../src/main.ts'),
        'sync',
        '--silent',
        ...(dryRun ? ['--dry-run'] : []),
      ],
      {
        inspectRaw: (stdout, stderr) => {
          raw = {stdout, stderr}
        },
      },
    )
    expect(result.exitCode).toBe(failed ? 1 : 0)
    expect(raw).toEqual({stdout: '', stderr: ''})
    if (failed || dryRun) expect(await protectedBytes(root)).toEqual(before)
    else expect(await readFile(join(root, trackedPath), 'utf8')).toBe('after')
    if (dryRun) expect(await readTree(reportDir)).toBe(beforeReports)
    else {
      const latest = JSON.parse(await readFile(join(reportDir, 'latest.json'), 'utf8'))
      expect(latest.success).toBe(!failed)
      if (failed) expect(latest.files.synced).toBe(0)
    }
  },
)
it('AC-23 silent incomplete recovery names the unrestored state even when report storage also fails', async () => {
  const root = dir(),
    {dependencies} = await handlerFixture(root)
  dependencies.reports.writeReport = async () => {
    throw new Error('report storage denied')
  }
  let restoring = false
  const transaction = {
    ...transactionIO,
    replace: async (...args: Parameters<typeof transactionIO.replace>) => {
      if (args[1].endsWith('forge.config.yaml') && !restoring) {
        restoring = true
        throw new Error('config failed ftps://user:credential-sentinel@fixture.invalid/repo')
      }
      if (args[1].endsWith('sync-state.json') && restoring) throw new Error('state restoration failed')
      await transactionIO.replace(...args)
    },
  }
  const stdout = spyOn(console, 'log').mockImplementation(() => {})
  const stderr = spyOn(console, 'error').mockImplementation(() => {})
  try {
    await runSyncWithDependencies({dryRun: false, silent: true, verbose: false}, {...dependencies, transaction})
    expect(process.exitCode).toBe(1)
    expect(stdout).not.toHaveBeenCalled()
    const message = stderr.mock.calls.flat().join(' ')
    expect(message).toContain('Recovery required')
    expect(message).toContain('.crucible/sync-state.json')
    expect(message).toContain('untrusted')
    expect(message).not.toContain('credential-sentinel')
    expect(await readFile(join(root, trackedPath), 'utf8')).toBe('before')
    expect(await readFile(join(root, `${trackedPath}.bak`), 'utf8')).toBe('before')
  } finally {
    stdout.mockRestore()
    stderr.mockRestore()
  }
})
