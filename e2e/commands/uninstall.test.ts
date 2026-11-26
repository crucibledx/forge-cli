/**
 * E2E tests for `forge uninstall`.
 */

import {existsSync} from 'node:fs'
import {mkdir, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {snapshot} from '@test-helpers/snapshot'
import {describe, expect, it} from 'bun:test'

import {hashContent} from '@domain/sync/state'
import {buildConfigYaml, writeConfig} from '@e2e/fixtures'
import {
  crucibleDirPath,
  N,
  runUninstallSession,
  TIMEOUT_MS,
  UNINSTALL_MESSAGES as M,
  useTmpDir,
  Y,
} from '@e2e/framework'

import {nativePairBytes, readNativePair, writeAmbiguousPair} from './sync/safety/helpers'

const getDir = useTmpDir('forge-uninstall')

describe('forge uninstall', () => {
  it(
    'removes .crucible directory when confirmed',
    async () => {
      const dir = getDir()
      await writeConfig(dir, buildConfigYaml({assistants: ['cursor']}))
      expect(existsSync(crucibleDirPath(dir))).toBe(true)

      await runUninstallSession(dir, (cli) => cli.waitForText('Continue?').pressKey(Y).waitForText(M.done))

      expect(existsSync(crucibleDirPath(dir))).toBe(false)
    },
    TIMEOUT_MS,
  )

  it(
    'cancels uninstall when user declines',
    async () => {
      const dir = getDir()
      await writeConfig(dir, buildConfigYaml({assistants: ['cursor']}))

      await runUninstallSession(dir, (cli) => cli.waitForText('Continue?').pressKey(N).waitForText(M.cancelled))

      expect(existsSync(crucibleDirPath(dir))).toBe(true)
    },
    TIMEOUT_MS,
  )

  it(
    'removes synced files during uninstall',
    async () => {
      const dir = getDir()
      await writeConfig(dir, buildConfigYaml({assistants: ['cursor']}))

      // Create a fake synced file and sync state
      const syncedFile = join(dir, '.claude', 'rules', 'deploy.md')
      await mkdir(join(dir, '.claude', 'rules'), {recursive: true})
      await writeFile(syncedFile, '# Deploy')

      const stateFile = join(dir, '.crucible', 'sync-state.json')
      await writeFile(
        stateFile,
        JSON.stringify({
          lastSync: '2026-06-18T12:00:00Z',
          files: {'.claude/rules/deploy.md': {hash: hashContent('# Deploy'), sourceName: 'default'}},
        }),
      )

      await runUninstallSession(dir, (cli) => cli.waitForText('Continue?').pressKey(Y).waitForText(M.done))

      expect(existsSync(syncedFile)).toBe(false)
      expect(existsSync(crucibleDirPath(dir))).toBe(false)
    },
    TIMEOUT_MS,
  )

  for (const literal of ['.claude/skills/a\\b.md', 'notes/a\\b.md'])
    it.skipIf(process.platform === 'win32')(
      `refuses ambiguous POSIX backslash state before prompting or changing files: ${literal}`,
      async () => {
        const dir = getDir()
        await writeConfig(dir, buildConfigYaml({assistants: ['claude-code']}))
        const paths = await writeAmbiguousPair(dir, literal)
        await writeFile(
          join(dir, '.crucible', 'sync-state.json'),
          JSON.stringify({
            lastSync: '',
            files: {[literal]: {hash: hashContent('literal owned bytes'), sourceName: 'default'}},
          }),
        )
        const before = await snapshot(dir)

        const result = await runUninstallSession(dir, (cli) => cli.waitForText('Ambiguous tracked backslash path'))

        expect(result.exitCode).toBe(1)
        expect(await snapshot(dir)).toEqual(before)
        expect(await readNativePair(dir, paths)).toMatchObject({
          exitCode: 0,
          signal: null,
          timedOut: false,
          stdout: nativePairBytes,
        })
      },
      TIMEOUT_MS,
    )
})
