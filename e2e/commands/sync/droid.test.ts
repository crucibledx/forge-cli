/**
 * E2E tests for syncing into Droid, project and global scope.
 *
 * Droid documents no rules directory, so source rules are reported as not delivered.
 */

import {existsSync} from 'node:fs'
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'

import {describe, expect, it} from 'bun:test'

import {buildConfigYaml, setupLocalSync, writeConfig, writeSourceTree} from '@e2e/fixtures'
import {runCommand, runSync, useTmpDir} from '@e2e/framework'

const getDir = useTmpDir('forge-sync-droid')

const TREE = {
  skills: {deploy: {'SKILL.md': '# Deploy'}},
  rules: {'style.md': '# Style'},
  workflows: {'review.md': '# Review'},
}

describe('forge sync — droid', () => {
  it('syncs skills and workflows into .factory and reports rules as not delivered', async () => {
    const dir = getDir()
    await setupLocalSync(dir, ['droid'], TREE)

    const {exitCode, output} = await runSync(dir)
    expect(exitCode).toBe(0)

    expect(await readFile(join(dir, '.factory', 'skills', 'deploy', 'SKILL.md'), 'utf-8')).toBe('# Deploy')
    expect(await readFile(join(dir, '.factory', 'commands', 'review.md'), 'utf-8')).toBe('# Review')
    expect(existsSync(join(dir, '.factory', 'rules'))).toBe(false)
    expect(output).toContain('Droid has no location for rules/ files; they are not delivered to Droid.')
  })

  it('syncs into ~/.factory with --global', async () => {
    const home = getDir()
    const sourceDir = join(home, 'global-source')
    await writeSourceTree(sourceDir, TREE)
    await writeConfig(home, buildConfigYaml({assistants: ['droid'], localSource: {path: sourceDir}}))

    const {exitCode, output} = await runCommand(home, '--global', ['sync'], {HOME: home})
    expect(exitCode).toBe(0)

    expect(await readFile(join(home, '.factory', 'skills', 'deploy', 'SKILL.md'), 'utf-8')).toBe('# Deploy')
    expect(await readFile(join(home, '.factory', 'commands', 'review.md'), 'utf-8')).toBe('# Review')
    expect(existsSync(join(home, '.factory', 'rules'))).toBe(false)
    expect(output).toContain('not delivered to Droid')
  })
})
