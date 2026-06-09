/**
 * E2E tests for `forge sync --global`.
 *
 * Verifies that --global operates on ~/.crucible/forge.config.yaml
 * and syncs to ~/ instead of cwd.
 */

import {existsSync} from 'node:fs'
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'

import {describe, expect, it} from 'bun:test'

import {buildConfigYaml, writeConfig, writeSourceTree} from '@e2e/fixtures'
import {runCommand, useTmpDir} from '@e2e/framework'

const getDir = useTmpDir('forge-sync-global')

describe('sync --global', () => {
  it('syncs to homedir using global config', async () => {
    const home = getDir()
    const projectDir = join(home, 'my-project')

    // Global source + config (lives in $HOME)
    const globalSourceDir = join(home, 'global-source')
    await writeSourceTree(globalSourceDir, {rules: {'global-rule.md': '# Global rule'}})
    await writeConfig(home, buildConfigYaml({assistants: ['claude-code'], localSource: {path: globalSourceDir}}))

    // Project source + config (lives in $HOME/my-project)
    const projectSourceDir = join(projectDir, 'source')
    await writeSourceTree(projectSourceDir, {rules: {'project-rule.md': '# Project rule'}})
    await writeConfig(projectDir, buildConfigYaml({assistants: ['claude-code'], localSource: {path: projectSourceDir}}))

    // Run sync --global from project dir — should use HOME config, not project config
    const {exitCode} = await runCommand(projectDir, '--global', ['sync'], {HOME: home})
    expect(exitCode).toBe(0)

    // Global rule synced to homedir
    expect(existsSync(join(home, '.claude', 'rules', 'global-rule.md'))).toBe(true)

    // Project rule NOT synced to homedir (global config doesn't know about it)
    expect(existsSync(join(home, '.claude', 'rules', 'project-rule.md'))).toBe(false)

    // Project dir untouched
    expect(existsSync(join(projectDir, '.claude', 'rules', 'project-rule.md'))).toBe(false)
  })

  it('reads global config content correctly', async () => {
    const home = getDir()
    const sourceDir = join(home, 'global-source')
    await writeSourceTree(sourceDir, {rules: {'api.md': '# API from global'}})
    await writeConfig(home, buildConfigYaml({assistants: ['claude-code'], localSource: {path: sourceDir}}))

    const {exitCode} = await runCommand(home, '--global', ['sync'], {HOME: home})
    expect(exitCode).toBe(0)

    const content = await readFile(join(home, '.claude', 'rules', 'api.md'), 'utf-8')
    expect(content).toBe('# API from global')
  })

  it('exits non-zero when no global config exists', async () => {
    const home = getDir()
    const {exitCode} = await runCommand(home, '--global', ['sync'], {HOME: home})
    expect(exitCode).not.toBe(0)
  })
})
