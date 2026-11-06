import {mkdir, readFile, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {protectedBytes, syncFixture, trackedPath} from '@test-helpers/sync-fixture'
import {useTmpDir} from '@test-helpers/tmp'
import {expect, it} from 'bun:test'

import {CLI_ENTRY} from '@e2e/framework/constants'
import {runPipe} from '@e2e/framework/pipe'

import {testEnvironment} from '../../../../scripts/test-sandbox'
import {readTree} from './helpers'

const dir = useTmpDir('silent-contract')
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
      [process.execPath, CLI_ENTRY, 'sync', '--silent', ...(dryRun ? ['--dry-run'] : [])],
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
