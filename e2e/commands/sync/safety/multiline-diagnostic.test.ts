import {existsSync} from 'node:fs'
import {readdir, readFile, stat} from 'node:fs/promises'
import {join} from 'node:path'

import {protectedBytes} from '@test-helpers/sync-fixture'
import {useTmpDir} from '@test-helpers/tmp'
import {expect, it} from 'bun:test'

import {testEnvironment} from '../../../../scripts/test-sandbox'
import {CLI_ENTRY} from '../../../framework/constants'
import {runPipe} from '../../../framework/pipe'
import {config} from './helpers'

const dir = useTmpDir('scalar-diagnostic-cli')
it.each(['|', '>-', 'plain'].flatMap((scalar) => [false, true].map((preview) => ({scalar, preview}))))(
  'AC-15,30 real CLI scalar failure keeps raw stdout/stderr/latest/history private: $scalar preview=$preview',
  async ({scalar, preview}) => {
    const root = dir(),
      first = 'CLI_SCALAR_FIRST_PRIVATE_Q',
      second = 'CLI_SCALAR_SECOND_PRIVATE_Q'
    const value =
      scalar === 'plain'
        ? `password: ${first} ${second}\n  ${first}\nvisible=yes`
        : `password: ${scalar}\n  ${first} ${second}\n  ${first}\nvisible=yes`
    await config(root, [{name: 'alpha', type: 'local', path: join(root, value)}])
    const before = await protectedBytes(root),
      sinks: string[] = []
    const result = await runPipe(root, [process.execPath, CLI_ENTRY, 'sync', ...(preview ? ['--dry-run'] : [])], {
      inspectRaw: (stdout, stderr) => {
        sinks.push(stdout, stderr)
      },
    })
    expect(result.exitCode).toBe(1)
    expect(await protectedBytes(root)).toEqual(before)
    const directory = join(testEnvironment(root).HOME!, '.crucible/forge/reports')
    if (preview) expect(existsSync(directory)).toBe(false)
    else {
      const latest = await readFile(join(directory, 'latest.json'), 'utf8')
      expect(JSON.parse(latest).success).toBe(false)
      expect(JSON.parse(latest).files.synced).toBe(0)
      for (const file of await readdir(directory, {recursive: true})) {
        const path = join(directory, file)
        if ((await stat(path)).isFile()) sinks.push(await readFile(path, 'utf8'))
      }
      expect(sinks.length).toBeGreaterThanOrEqual(4)
    }
    for (const sink of sinks) {
      expect(sink).not.toContain(first)
      expect(sink).not.toContain(second)
    }
    expect(sinks[0]).toContain('visible=yes')
  },
)
