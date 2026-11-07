import {readdir, readFile, stat} from 'node:fs/promises'
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

it.each(['|', '>-', 'plain'].flatMap((scalar) => [false, true].map((dryRun) => ({scalar, dryRun}))))(
  'AC-15,30 complete scalar source failures preserve private raw reports: $scalar preview=$dryRun',
  async ({scalar, dryRun}) => {
    const root = dir(),
      {context} = await syncFixture(root),
      before = await protectedBytes(root)
    const directory = join(root, 'observed-scalar-reports'),
      reports = createReportService(directory)
    const first = 'MULTILINE_FIRST_PRIVATE_Q',
      second = 'MULTILINE_SECOND_PRIVATE_Q'
    const diagnostic =
      scalar === 'plain'
        ? `password: ${first} ${second}\n  ${first}\nvisible=yes`
        : `password: ${scalar}\n  ${first} ${second}\n  ${first}\nvisible=yes`
    const output = spyOn(console, 'log').mockImplementation(() => {})
    let visible = ''
    try {
      await runSyncWithDependencies(
        {dryRun, silent: false, verbose: false},
        {
          io: {resolveProjectRoot: () => root, buildContext: async () => context},
          loadSource: async () => {
            throw new Error(diagnostic)
          },
          reports,
        },
      )
      visible = output.mock.calls.flat().join('\n')
    } finally {
      output.mockRestore()
    }
    expect(process.exitCode).toBe(1)
    expect(await protectedBytes(root)).toEqual(before)
    const latest = await reports.readLatest(),
      history = await reports.readHistory()
    expect(latest?.success ?? null).toBe(dryRun ? null : false)
    expect(history).toHaveLength(dryRun ? 0 : 1)
    const sinks = [visible]
    if (!dryRun) {
      expect(latest?.files.synced).toBe(0)
      for (const file of await readdir(directory, {recursive: true})) {
        const path = join(directory, file)
        if ((await stat(path)).isFile()) sinks.push(await readFile(path, 'utf8'))
      }
      expect(sinks.length).toBeGreaterThanOrEqual(3)
    }
    for (const sink of sinks) {
      expect(sink).not.toContain(first)
      expect(sink).not.toContain(second)
      expect(sink).toContain('visible=yes')
    }
  },
)

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
