import {join} from 'node:path'

import {protectedBytes, syncFixture} from '@test-helpers/sync-fixture'
import {useTmpDir} from '@test-helpers/tmp'
import {afterEach, expect, it, spyOn} from 'bun:test'

import {createReportService} from '@infrastructure/report'

import {runSyncWithDependencies} from './handler'

const dir = useTmpDir('multiline-diagnostic')
afterEach(() => {
  process.exitCode = 0
})

it.each(['password:\n  ', 'password:\r\n\t', 'client_secret=\n\n  '])(
  'AC-15,30 actual source failure redacts multiline values from human output and latest/history: %j',
  async (prefix) => {
    const root = dir()
    const {context} = await syncFixture(root)
    const before = await protectedBytes(root)
    const reports = createReportService(join(root, 'observed-reports'))
    const sentinel = 'MULTILINE_DIAGNOSTIC_PRIVATE'
    const output = spyOn(console, 'log').mockImplementation(() => {})
    let visible = ''
    try {
      await runSyncWithDependencies(
        {dryRun: false, silent: false, verbose: false},
        {
          io: {resolveProjectRoot: () => root, buildContext: async () => context},
          loadSource: async () => {
            throw new Error(`${prefix}${sentinel}\nvisible=yes`)
          },
          reports,
        },
      )
      visible = output.mock.calls.flat().join('\n')
    } finally {
      output.mockRestore()
    }
    const latest = await reports.readLatest()
    const history = await reports.readHistory()
    expect(process.exitCode).toBe(1)
    expect(await protectedBytes(root)).toEqual(before)
    expect(latest?.success).toBe(false)
    expect(latest?.files.synced).toBe(0)
    expect(history).toHaveLength(1)
    for (const text of [visible, JSON.stringify(latest), JSON.stringify(history)]) {
      expect(text).not.toContain(sentinel)
      expect(text).toContain('visible=yes')
    }
  },
)
