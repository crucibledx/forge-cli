/**
 * E2E tests for `forge uninstall`.
 */

import {existsSync} from 'node:fs'
import {mkdir, writeFile} from 'node:fs/promises'
import {join} from 'node:path'

import {describe, expect, it} from 'bun:test'

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
          files: {'.claude/rules/deploy.md': {hash: 'abc', sourceName: 'default'}},
        }),
      )

      await runUninstallSession(dir, (cli) => cli.waitForText('Continue?').pressKey(Y).waitForText(M.done))

      expect(existsSync(syncedFile)).toBe(false)
      expect(existsSync(crucibleDirPath(dir))).toBe(false)
    },
    TIMEOUT_MS,
  )
})
